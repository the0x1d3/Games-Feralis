import { createBattle, reduceBattle, type BattleAction } from '@domain/battle/battle';
import type { BattleContext, BattleOutcome, BattleState } from '@domain/battle/state';
import type { Clock } from '@domain/clock';
import { evolve, pendingEvolution } from '@domain/creature/evolution';
import { createCreature, healParty, type CreatureInstance } from '@domain/creature/instance';
import { admit, replaceCreature, type Roster } from '@domain/creature/roster';
import type { Species } from '@domain/creature/species';
import { grantXp, splitXp, xpFromOpponent } from '@domain/creature/xp';
import type { Encounter } from '@domain/world/encounters';
import { rosterOf } from './gameState';
import type { GameContent } from './loadContent';
import type { RngRuntime } from './rngRuntime';
import type { Store } from './store';

/**
 * Il combattimento visto da fuori.
 *
 * Fa da cerniera fra la macchina a stati pura (`src/domain/battle/`) e lo store
 * del mondo. Qui si decide cosa sopravvive allo scontro: HP e stati, punti
 * esperienza, evoluzioni, l'esemplare catturato, i Nodi consumati.
 *
 * Le conseguenze si applicano **appena lo scontro finisce**, non quando il
 * giocatore preme Continua: chiudere la scheda davanti al pannello di riepilogo
 * non deve far perdere una cattura.
 */

export interface BattleDeps {
  readonly store: Store;
  readonly content: GameContent;
  readonly rng: RngRuntime;
  readonly clock: Clock;
  readonly isNight: () => boolean;
  /** Dove ci si risveglia dopo un KO. Diventerà il Totem in Fase 4. */
  readonly onDefeat: () => void;
}

export interface LevelUpReport {
  readonly uid: string;
  readonly nameKey: string;
  readonly to: number;
}

export interface EvolutionReport {
  readonly uid: string;
  readonly fromNameKey: string;
  readonly toNameKey: string;
}

export interface BattleSummary {
  readonly outcome: BattleOutcome;
  readonly xp: number;
  readonly levelUps: readonly LevelUpReport[];
  readonly evolutions: readonly EvolutionReport[];
  /** Vero se il Ferale catturato è finito in deposito invece che in squadra. */
  readonly toStorage: boolean;
}

export interface ActiveBattle {
  readonly state: BattleState;
  readonly wild: CreatureInstance;
  readonly species: Species;
  readonly summary?: BattleSummary;
}

export interface BattleController {
  current(): ActiveBattle | undefined;
  context(): BattleContext;
  start(encounter: Encounter): void;
  tick(): void;
  submit(action: BattleAction): void;
  /** Chiude lo scontro e restituisce il controllo al mondo. */
  end(): void;
  subscribe(listener: () => void): () => void;
}

function averageLevel(party: readonly CreatureInstance[]): number {
  if (party.length === 0) return 1;
  return party.reduce((sum, member) => sum + member.level, 0) / party.length;
}

export function createBattleController(deps: BattleDeps): BattleController {
  const listeners = new Set<() => void>();
  let active: ActiveBattle | undefined;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  function buildContext(): BattleContext {
    return {
      config: deps.content.battle,
      creatures: deps.content.creatures,
      moves: deps.content.moves,
      species: deps.content.species,
      items: deps.content.items,
      isNight: deps.isNight(),
      teamLevel: averageLevel(deps.store.getState().party),
    };
  }

  /** Riporta nella squadra gli HP e gli stati con cui si esce dal combattimento. */
  function carryOver(state: BattleState, roster: Roster): Roster {
    const party = roster.party.map((member): CreatureInstance => {
      const fought = state.player.members.find((entry) => entry.uid === member.uid);
      if (fought === undefined) return member;

      // Con `exactOptionalPropertyTypes` la chiave va omessa, non messa a undefined.
      const { status: _scarta, ...rest } = member;
      const status = fought.status?.id;
      return status === undefined ? { ...rest, hp: fought.hp } : { ...rest, hp: fought.hp, status };
    });
    return { ...roster, party };
  }

  /**
   * Assegna l'esperienza e fa evolvere chi ha raggiunto la soglia.
   *
   * Chi ha combattuto prende la quota piena, la panchina una frazione: tenere
   * un Ferale di riserva non deve significare lasciarlo indietro per sempre.
   */
  function awardXp(
    roster: Roster,
    state: BattleState,
    total: number,
  ): { roster: Roster; levelUps: LevelUpReport[]; evolutions: EvolutionReport[] } {
    const share = splitXp(total, deps.content.creatures);

    // Ha combattuto chi è sceso in campo: lo slot 0 più ogni cambio registrato.
    // Dedurlo dagli HP o dalla barra sarebbe fragile — un Ferale può uscire da
    // uno scontro intatto, e la barra si azzera a ogni azione.
    const entered = new Set<number>([0]);
    for (const event of state.log) {
      if (event.kind === 'switch' && event.side === 'player') entered.add(event.index);
    }
    const fought = new Set(
      [...entered]
        .map((index) => state.player.members[index]?.uid)
        .filter((uid) => uid !== undefined),
    );

    const levelUps: LevelUpReport[] = [];
    const evolutions: EvolutionReport[] = [];
    let current = roster;

    for (const member of roster.party) {
      const species = deps.content.species.get(member.speciesId);
      if (species === undefined) continue;

      const amount = fought.has(member.uid) ? share.active : share.bench;
      const result = grantXp(member, amount, species, deps.content.creatures);
      let creature = result.creature;

      if (result.levelUp !== undefined) {
        levelUps.push({ uid: creature.uid, nameKey: species.nameKey, to: result.levelUp.to });

        const next = pendingEvolution(creature, species, deps.content.species);
        if (next !== undefined) {
          const outcome = evolve(creature, species, next, deps.content.creatures);
          creature = outcome.creature;
          evolutions.push({
            uid: creature.uid,
            fromNameKey: species.nameKey,
            toNameKey: next.nameKey,
          });
          deps.store.dispatch({ type: 'seeSpecies', speciesId: next.id });
        }
      }

      current = replaceCreature(current, creature);
    }

    return { roster: current, levelUps, evolutions };
  }

  /** Applica tutte le conseguenze dello scontro. Chiamata una volta sola. */
  function settle(state: BattleState): BattleSummary {
    const outcome = state.outcome ?? 'fled';
    let roster = carryOver(state, rosterOf(deps.store.getState()));

    let xp = 0;
    let levelUps: readonly LevelUpReport[] = [];
    let evolutions: readonly EvolutionReport[] = [];

    if (outcome === 'won' || outcome === 'captured') {
      const wild = state.enemy.members[0];
      if (wild !== undefined) {
        xp = xpFromOpponent(wild.level, wild.isAlpha, deps.content.creatures);
        const awarded = awardXp(roster, state, xp);
        roster = awarded.roster;
        levelUps = awarded.levelUps;
        evolutions = awarded.evolutions;
      }
      if (outcome === 'won') deps.store.dispatch({ type: 'battleWon' });
    }

    /*
     * Sconfitta: la squadra si rimette in piedi e il giocatore si risveglia
     * altrove (PDR §5.6). Senza, una squadra a zero PV sarebbe un vicolo cieco.
     */
    if (outcome === 'lost') {
      roster = {
        ...roster,
        party: healParty(roster.party, deps.content.species, deps.content.creatures),
      };
    }

    let toStorage = false;

    if (outcome === 'captured' && active !== undefined) {
      const caught = state.enemy.members.find((entry) => entry.uid === active?.wild.uid);
      const creature: CreatureInstance = {
        ...active.wild,
        hp: caught?.hp ?? active.wild.hp,
      };
      toStorage = roster.party.length >= deps.content.battle.partySize;
      roster = admit(roster, creature, deps.content.battle.partySize);
    }

    deps.store.dispatch({ type: 'setRoster', roster });

    if (outcome === 'captured' && active !== undefined) {
      // L'archivio e il contatore delle catture hanno il loro riduttore: il
      // roster è già a posto, qui si registra soltanto che è stato preso.
      deps.store.dispatch({ type: 'countCapture', speciesId: active.wild.speciesId });
    }

    if (outcome === 'lost') deps.onDefeat();

    // La posizione dello stream torna nella sessione: senza, ricaricare la
    // pagina farebbe rivedere gli stessi esiti (errata E6).
    deps.rng.setState('battle', state.rngState);
    deps.store.dispatch({ type: 'syncRng', streams: deps.rng.snapshot() });

    return { outcome, xp, levelUps, evolutions, toStorage };
  }

  function update(next: BattleState): void {
    if (active === undefined) return;

    const justEnded = next.phase === 'over' && active.summary === undefined;
    active = { ...active, state: next };
    if (justEnded) active = { ...active, summary: settle(next) };
    notify();
  }

  return {
    current: () => active,
    context: buildContext,

    start(encounter) {
      const state = deps.store.getState();
      const wild = createCreature(
        {
          species: encounter.species,
          level: encounter.level,
          isAlpha: encounter.isAlpha,
          caughtAt: deps.clock.now(),
        },
        deps.content.creatures,
        deps.rng.stream('world'),
      );

      const battle = createBattle(
        {
          playerTeam: state.party,
          enemyTeam: [wild],
          // L'erba alta usa l'IA casuale: un incontro qualunque non deve giocare
          // meglio di un Custode.
          aiLevel: 'random',
          rngState: deps.rng.stream('battle').getState(),
        },
        buildContext(),
      );

      active = { state: battle, wild, species: encounter.species };
      deps.store.dispatch({ type: 'seeSpecies', speciesId: encounter.species.id });
      deps.store.dispatch({ type: 'syncRng', streams: deps.rng.snapshot() });
      notify();
    },

    tick() {
      if (active === undefined || active.state.phase !== 'running') return;
      update(reduceBattle(active.state, { type: 'tick' }, buildContext()));
    },

    submit(action) {
      if (active === undefined || active.state.phase !== 'awaitingPlayer') return;
      if (action.type === 'capture') {
        deps.store.dispatch({ type: 'consumeItem', itemId: action.toolId, amount: 1 });
      }
      if (action.type === 'item') {
        // Il consumo avviene qui e non nel dominio: la scorta vive nello store,
        // il combattimento conosce solo l'effetto.
        deps.store.dispatch({ type: 'consumeItem', itemId: action.itemId, amount: 1 });
      }
      update(reduceBattle(active.state, action, buildContext()));
    },

    end() {
      if (active === undefined) return;
      active = undefined;
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
