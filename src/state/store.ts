import type { CreatureInstance } from '@domain/creature/instance';
import type { RngStreamStates } from '@domain/rng';
import { advanceClock } from '@domain/world/time';
import type { WorldConfig } from '@domain/world/config';
import { type MoveInput, stepActor } from '@domain/world/movement';
import type { Zone } from '@domain/world/zone';
import { archiveWith, type GameState } from './gameState';

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
  | { readonly type: 'markSaved'; readonly at: number }
  /** Un Ferale entra in squadra: il regalo iniziale o una cattura. */
  | {
      readonly type: 'grantCreature';
      readonly creature: CreatureInstance;
      readonly caught: boolean;
    }
  /** La squadra torna dal combattimento con HP e stati aggiornati. */
  | { readonly type: 'updateParty'; readonly party: readonly CreatureInstance[] }
  | { readonly type: 'seeSpecies'; readonly speciesId: string }
  | { readonly type: 'consumeItem'; readonly itemId: string; readonly amount: number }
  | { readonly type: 'battleWon' }
  /** Rimette nello stato la posizione degli stream dopo che il gioco li ha usati. */
  | { readonly type: 'syncRng'; readonly streams: RngStreamStates };

export interface ReducerDeps {
  readonly config: WorldConfig;
  readonly zones: ReadonlyMap<string, Zone>;
  /** Da `battle.json`: quanti Ferali stanno in squadra. */
  readonly partySize: number;
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
          zone.collision,
          {
            speedTilesPerSecond: deps.config.player.speedTilesPerSecond,
            body: deps.config.player.body,
          },
        );

        return {
          ...state,
          player: { zoneId: state.player.zoneId, x: moved.x, y: moved.y, facing: moved.facing },
          world: { gameTimeMs: advanceClock(state.world.gameTimeMs, action.deltaMs) },
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

      case 'setFlag':
        return { ...state, flags: { ...state.flags, [action.key]: action.value } };

      case 'markSaved':
        return { ...state, lastSavedAt: action.at };

      case 'grantCreature': {
        // Oltre la dimensione della squadra il Ferale andrebbe nel deposito,
        // che arriva in Fase 3: fino ad allora la squadra è il limite.
        if (state.party.length >= deps.partySize) return state;
        return {
          ...state,
          party: [...state.party, action.creature],
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

      case 'updateParty':
        return { ...state, party: action.party };

      case 'seeSpecies':
        return { ...state, archive: archiveWith(state.archive, action.speciesId, { seen: true }) };

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
