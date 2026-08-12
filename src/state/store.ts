import type { BaseConfig, StructureDef } from '@domain/base/config';
import type { Recipe } from '@domain/economy/crafting';
import type { TechConfig } from '@domain/economy/tech';
import { maxHp, type CreatureInstance } from '@domain/creature/instance';
import {
  admit,
  findInRoster,
  moveToParty,
  moveToStorage,
  rename,
  replaceCreature,
  swapParty,
  type Roster,
} from '@domain/creature/roster';
import type { Species } from '@domain/creature/species';
import type { CreatureConfig } from '@domain/creature/stats';
import { applyItem, type ItemDef } from '@domain/economy/items';
import type { RngStreamStates } from '@domain/rng';
import { advanceClock } from '@domain/world/time';
import type { WorldConfig } from '@domain/world/config';
import { type MoveInput, stepActor } from '@domain/world/movement';
import type { Zone } from '@domain/world/zone';
import { reduceBase, tickBase, type BaseAction } from './baseActions';
import { canClear, clearedFlag, isCleared, obstaclesOf } from '@domain/world/obstacles';
import { collisionFor } from './collisionCache';
import { archiveWith, rosterOf, type GameState } from './gameState';

/**
 * Store minimo: azioni in ingresso, stato nuovo in uscita, ascoltatori
 * notificati. Nessuna libreria, perche' non c'e' nulla da astrarre.
 *
 * Il riduttore non fa calcoli suoi: delega a `src/domain/`. Se un giorno una
 * regola di gioco finisce qui dentro, il progetto ha perso il confine.
 */

export type GameAction =
  /** Un passo di simulazione a durata fissa. */
  | { readonly type: 'tick'; readonly deltaMs: number; readonly input: MoveInput }
  | {
      readonly type: 'enterZone';
      readonly zoneId: string;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'setFlag'; readonly key: string; readonly value: boolean }
  /** Rimuove un ostacolo dal mondo, se in squadra c'è chi sa farlo. */
  | { readonly type: 'clearObstacle'; readonly zoneId: string; readonly obstacleId: string }
  | { readonly type: 'markSaved'; readonly at: number }
  /** Un Ferale entra in squadra, o in deposito se la squadra è piena. */
  | {
      readonly type: 'grantCreature';
      readonly creature: CreatureInstance;
      readonly caught: boolean;
    }
  /** Squadra e deposito insieme: esiti di combattimento, livelli, evoluzioni. */
  | { readonly type: 'setRoster'; readonly roster: Roster }
  | { readonly type: 'moveToParty'; readonly uid: string }
  | { readonly type: 'moveToStorage'; readonly uid: string }
  | { readonly type: 'swapParty'; readonly a: number; readonly b: number }
  | { readonly type: 'renameCreature'; readonly uid: string; readonly nickname: string }
  /** Usa un consumabile. Se non ha effetto, non viene consumato. */
  | { readonly type: 'useItem'; readonly itemId: string; readonly uid: string }
  | { readonly type: 'seeSpecies'; readonly speciesId: string }
  /** Registra una cattura nell'archivio e nelle statistiche. */
  | { readonly type: 'countCapture'; readonly speciesId: string }
  /* La Radura: piantare, costruire, assegnare, recuperare (baseActions.ts). */
  | BaseAction
  | { readonly type: 'consumeItem'; readonly itemId: string; readonly amount: number }
  | { readonly type: 'battleWon' }
  /** Rimette nello stato la posizione degli stream dopo che il gioco li ha usati. */
  | { readonly type: 'syncRng'; readonly streams: RngStreamStates };

export interface ReducerDeps {
  readonly config: WorldConfig;
  readonly zones: ReadonlyMap<string, Zone>;
  /** Da `battle.json`: quanti Ferali stanno in squadra. */
  readonly partySize: number;
  readonly species: ReadonlyMap<string, Species>;
  readonly creatures: CreatureConfig;
  readonly items: ReadonlyMap<string, ItemDef>;
  readonly baseConfig: BaseConfig;
  readonly structureDefs: ReadonlyMap<string, StructureDef>;
  readonly recipes: ReadonlyMap<string, Recipe>;
  readonly tech: TechConfig;
}

function requireZone(deps: ReducerDeps, zoneId: string): Zone {
  const zone = deps.zones.get(zoneId);
  if (zone === undefined) throw new Error(`Zona sconosciuta: "${zoneId}"`);
  return zone;
}

export function createReducer(deps: ReducerDeps) {
  return function reduce(state: GameState, action: GameAction): GameState {
    switch (action.type) {
      case 'tick': {
        const zone = requireZone(deps, state.player.zoneId);
        const moved = stepActor(
          { ...state.player, moving: false },
          action.input,
          action.deltaMs / 1000,
          collisionFor(zone, state.flags),
          {
            speedTilesPerSecond: deps.config.player.speedTilesPerSecond,
            body: deps.config.player.body,
          },
        );

        const gameTimeMs = advanceClock(state.world.gameTimeMs, action.deltaMs);

        // La Radura produce anche mentre cammini: è la stessa funzione che
        // gira offline, chiamata con un tick invece che con un segmento.
        const worked = tickBase(state, action.deltaMs, gameTimeMs, deps);

        // Quel che esce dal banco va nello zaino, non nel magazzino: è la
        // differenza fra una risorsa e un oggetto (E8).
        const inventory = { ...state.inventory };
        for (const [id, amount] of Object.entries(worked.crafted)) {
          inventory[id] = (inventory[id] ?? 0) + amount;
        }

        return {
          ...state,
          player: { zoneId: state.player.zoneId, x: moved.x, y: moved.y, facing: moved.facing },
          world: { gameTimeMs },
          base: worked.base,
          inventory,
          stats: { ...state.stats, playtimeMs: state.stats.playtimeMs + action.deltaMs },
        };
      }

      case 'enterZone': {
        requireZone(deps, action.zoneId);
        const visited = state.stats.zonesVisited.includes(action.zoneId)
          ? state.stats.zonesVisited
          : [...state.stats.zonesVisited, action.zoneId];

        return {
          ...state,
          player: {
            zoneId: action.zoneId,
            x: action.x,
            y: action.y,
            facing: state.player.facing,
          },
          stats: { ...state.stats, zonesVisited: visited },
        };
      }

      /*
       * La "regola d'oro" del PDR §4.3: un Ferale con la mansione giusta apre
       * un passaggio. Chi decide se si può è `domain/world/obstacles.ts`; qui
       * si alza soltanto la bandiera, e la collisione ne è la conseguenza.
       */
      case 'clearObstacle': {
        const zone = deps.zones.get(action.zoneId);
        if (zone === undefined) return state;

        const obstacle = obstaclesOf(zone).find((entry) => entry.id === action.obstacleId);
        if (obstacle === undefined) return state;
        if (isCleared(state.flags, zone.id, obstacle.id)) return state;

        const check = canClear(obstacle, state.party, deps.species, state.inventory);
        if (!check.ok) return state;

        return {
          ...state,
          flags: { ...state.flags, [clearedFlag(zone.id, obstacle.id)]: true },
        };
      }

      case 'setFlag':
        return { ...state, flags: { ...state.flags, [action.key]: action.value } };

      case 'markSaved':
        return { ...state, lastSavedAt: action.at };

      case 'grantCreature': {
        // In squadra se c'è posto, altrimenti in deposito: catturare non deve
        // mai essere un'azione che non produce nulla.
        const roster = admit(rosterOf(state), action.creature, deps.partySize);
        const nuova = state.archive[action.creature.speciesId]?.seen !== true;
        return {
          ...state,
          techPoints: state.techPoints + (nuova ? deps.tech.points.firstEncounter : 0),
          party: roster.party,
          storage: roster.storage,
          archive: archiveWith(state.archive, action.creature.speciesId, {
            seen: true,
            caught: action.caught ? 1 : 0,
          }),
          stats: {
            ...state.stats,
            creaturesCaught: state.stats.creaturesCaught + (action.caught ? 1 : 0),
          },
        };
      }

      case 'setRoster':
        return { ...state, party: action.roster.party, storage: action.roster.storage };

      case 'moveToParty': {
        const result = moveToParty(rosterOf(state), action.uid, deps.partySize);
        if (!result.changed) return state;
        return { ...state, party: result.roster.party, storage: result.roster.storage };
      }

      case 'moveToStorage': {
        const result = moveToStorage(rosterOf(state), action.uid);
        if (!result.changed) return state;
        return { ...state, party: result.roster.party, storage: result.roster.storage };
      }

      case 'swapParty': {
        const result = swapParty(rosterOf(state), action.a, action.b);
        if (!result.changed) return state;
        return { ...state, party: result.roster.party };
      }

      case 'renameCreature': {
        const result = rename(rosterOf(state), action.uid, action.nickname);
        if (!result.changed) return state;
        return { ...state, party: result.roster.party, storage: result.roster.storage };
      }

      case 'useItem': {
        const item = deps.items.get(action.itemId);
        const roster = rosterOf(state);
        const target = findInRoster(roster, action.uid);
        if (item === undefined || target === undefined) return state;
        if ((state.inventory[action.itemId] ?? 0) <= 0) return state;

        const species = deps.species.get(target.speciesId);
        if (species === undefined) return state;

        const use = applyItem(item, target, maxHp(target, species, deps.creatures));
        // Un oggetto che non ha effetto non viene consumato: sprecarlo per una
        // distrazione è frustrazione gratuita.
        if (!use.applied) return state;

        const next = replaceCreature(roster, use.creature);
        return {
          ...state,
          party: next.party,
          storage: next.storage,
          inventory: {
            ...state.inventory,
            [action.itemId]: (state.inventory[action.itemId] ?? 0) - 1,
          },
        };
      }

      /*
       * Il primo avvistamento di una specie vale un Punto Tecnologia (PDR §4.5).
       * È il motivo per cui esplorare e collezionare alimentano l'albero: senza,
       * i punti arriverebbero solo dai Custodi e la Fase 5 non avrebbe economia.
       */
      case 'seeSpecies': {
        if (state.archive[action.speciesId]?.seen === true) return state;
        return {
          ...state,
          archive: archiveWith(state.archive, action.speciesId, { seen: true }),
          techPoints: state.techPoints + deps.tech.points.firstEncounter,
        };
      }

      case 'countCapture':
        return {
          ...state,
          archive: archiveWith(state.archive, action.speciesId, { seen: true, caught: 1 }),
          stats: { ...state.stats, creaturesCaught: state.stats.creaturesCaught + 1 },
        };

      case 'plantTotem':
      case 'build':
      case 'demolish':
      case 'assignWorker':
      case 'unassignWorker':
      case 'applyOffline':
      case 'loseOnDefeat':
      case 'unlockTech':
      case 'awardTechPoints':
      case 'queueCraft':
      case 'cancelCraft':
        return reduceBase(state, action, deps);

      case 'consumeItem': {
        const left = Math.max(0, (state.inventory[action.itemId] ?? 0) - action.amount);
        return { ...state, inventory: { ...state.inventory, [action.itemId]: left } };
      }

      case 'battleWon':
        return { ...state, stats: { ...state.stats, battlesWon: state.stats.battlesWon + 1 } };

      case 'syncRng':
        return { ...state, rngStreams: action.streams };
    }
  };
}

export interface Store {
  getState(): GameState;
  dispatch(action: GameAction): void;
  /** Registra un ascoltatore e restituisce la funzione per disiscriverlo. */
  subscribe(listener: (state: GameState) => void): () => void;
  /** Sostituisce lo stato di netto: serve al caricamento di un salvataggio. */
  replace(state: GameState): void;
}

export function createStore(initial: GameState, deps: ReducerDeps): Store {
  const reduce = createReducer(deps);
  const listeners = new Set<(state: GameState) => void>();
  let state = initial;

  const notify = (): void => {
    for (const listener of listeners) listener(state);
  };

  return {
    getState: () => state,
    dispatch(action) {
      state = reduce(state, action);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replace(next) {
      state = next;
      notify();
    },
  };
}
