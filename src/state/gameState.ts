import { createStreamStates, type RngStreamStates } from '@domain/rng';
import type { WorldConfig } from '@domain/world/config';
import { startingTotalMs } from '@domain/world/time';
import type { Facing } from '@domain/world/zone';

/**
 * Lo stato salvato di una partita.
 *
 * `schemaVersion` c'e' dal primo giorno perche' e' impossibile aggiungerlo
 * dopo: al primo aggiornamento senza, tutti i salvataggi diventano
 * indistinguibili fra vecchi e nuovi. Il PDR lo elenca fra gli anti-pattern
 * vietati, e la promessa "un salvataggio non deve mai essere invalidato da un
 * update" (§6.4) e' la piu' importante che il progetto fa ai giocatori.
 */

export const SCHEMA_VERSION = 1;

export interface PlayerState {
  readonly zoneId: string;
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
}

export interface WorldState {
  /** Millisecondi di gioco trascorsi: da qui si derivano ora, giorno e fase. */
  readonly gameTimeMs: number;
}

export interface StatsState {
  readonly playtimeMs: number;
  readonly zonesVisited: readonly string[];
}

export interface GameState {
  readonly schemaVersion: number;
  readonly gameVersion: string;
  readonly createdAt: number;
  readonly lastSavedAt: number;
  readonly rngStreams: RngStreamStates;
  readonly player: PlayerState;
  readonly world: WorldState;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly stats: StatsState;
}

export interface NewGameOptions {
  readonly now: number;
  readonly masterSeed: number;
  readonly gameVersion: string;
  readonly config: WorldConfig;
  readonly spawn: { readonly x: number; readonly y: number };
}

export function createNewGame(options: NewGameOptions): GameState {
  return {
    schemaVersion: SCHEMA_VERSION,
    gameVersion: options.gameVersion,
    createdAt: options.now,
    lastSavedAt: options.now,
    rngStreams: createStreamStates(options.masterSeed),
    player: {
      zoneId: options.config.startZoneId,
      x: options.spawn.x,
      y: options.spawn.y,
      facing: 'down',
    },
    world: { gameTimeMs: startingTotalMs(options.config.time) },
    flags: {},
    stats: { playtimeMs: 0, zonesVisited: [options.config.startZoneId] },
  };
}
