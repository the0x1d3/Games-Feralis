import type { Clock } from '@domain/clock';
import { createBattle, reduceBattle, type BattleAction } from '@domain/battle/battle';
import type { BattleContext, BattleState } from '@domain/battle/state';
import { createCreature, healParty, type CreatureInstance } from '@domain/creature/instance';
import type { Species } from '@domain/creature/species';
import type { Encounter } from '@domain/world/encounters';
import type { GameContent } from './loadContent';
import type { Store } from './store';
import type { RngRuntime } from './rngRuntime';

/**
 * Il combattimento visto da fuori.
 *
 * Fa da cerniera fra la macchina a stati pura (`src/domain/battle/`) e lo
 * store del mondo. Le scene non parlano mai direttamente con il dominio: qui
 * si decide anche cosa sopravvive allo scontro — HP e stati della squadra,
 * l'esemplare catturato, i Nodi consumati.
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

export interface ActiveBattle {
  readonly state: BattleState;
  readonly wild: CreatureInstance;
  readonly species: Species;
}

export interface BattleController {
  current(): ActiveBattle | undefined;
  context(): BattleContext;
  start(encounter: Encounter): void;
  tick(): void;
  submit(action: BattleAction): void;
  /** Applica gli esiti allo store e chiude lo scontro. */
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
      isNight: deps.isNight(),
      teamLevel: averageLevel(deps.store.getState().party),
    };
  }

  function update(next: BattleState): void {
    if (active === undefined) return;
    active = { ...active, state: next };
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
          // L'erba alta usa l'IA casuale: un incontro qualunque non deve
          // giocare meglio di un Custode.
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
      update(reduceBattle(active.state, action, buildContext()));
    },

    end() {
      if (active === undefined) return;
      const { state, wild, species } = active;

      /*
       * Gli HP e gli stati tornano nella squadra: un combattimento che non
       * lascia traccia toglie ogni peso alle decisioni prese dentro.
       */
      const party = deps.store.getState().party.map((member): CreatureInstance => {
        const fought = state.player.members.find((entry) => entry.uid === member.uid);
        if (fought === undefined) return member;

        // Lo stato alterato si porta dietro solo se c'è ancora: con
        // `exactOptionalPropertyTypes` la chiave va omessa, non messa a undefined.
        const { status: _scarta, ...rest } = member;
        const status = fought.status?.id;
        return status === undefined
          ? { ...rest, hp: fought.hp }
          : { ...rest, hp: fought.hp, status };
      });
      deps.store.dispatch({ type: 'updateParty', party });

      if (state.outcome === 'won') deps.store.dispatch({ type: 'battleWon' });

      /*
       * Sconfitta: la squadra si rimette in piedi e il giocatore si risveglia
       * altrove (PDR §5.6). Senza, una squadra a zero PV sarebbe un vicolo
       * cieco: ogni scontro successivo finirebbe perso in partenza.
       */
      if (state.outcome === 'lost') {
        deps.store.dispatch({
          type: 'updateParty',
          party: healParty(party, deps.content.species, deps.content.creatures),
        });
        deps.onDefeat();
      }

      if (state.outcome === 'captured') {
        const caught = state.enemy.members.find((entry) => entry.uid === wild.uid);
        deps.store.dispatch({
          type: 'grantCreature',
          creature: { ...wild, hp: caught?.hp ?? wild.hp, speciesId: species.id },
          caught: true,
        });
      }

      // La posizione degli stream torna nello stato: senza, ricaricare la
      // pagina farebbe rivedere gli stessi esiti (errata E6).
      deps.rng.setState('battle', state.rngState);
      deps.store.dispatch({ type: 'syncRng', streams: deps.rng.snapshot() });

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
