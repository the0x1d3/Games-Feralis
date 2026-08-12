import type { CreatureInstance } from '@domain/creature/instance';
import { createStreamStates, type RngStreamStates } from '@domain/rng';
import type { WorldConfig } from '@domain/world/config';
import { startingTotalMs } from '@domain/world/time';
import type { Facing } from '@domain/world/zone';

/**
 * Lo stato salvato di una partita.
 *
 * `schemaVersion` c'è dal primo giorno perché è impossibile aggiungerlo dopo:
 * al primo aggiornamento senza, tutti i salvataggi diventano indistinguibili
 * fra vecchi e nuovi. La promessa "un salvataggio non deve mai essere
 * invalidato da un update" (PDR §6.4) è la più importante che il progetto fa
 * ai giocatori.
 *
 * Schema 2 (Fase 2): squadra, archivio delle specie e inventario.
 */

export const SCHEMA_VERSION = 2;

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
  readonly battlesWon: number;
  readonly creaturesCaught: number;
}

export interface ArchiveEntry {
  readonly seen: boolean;
  readonly caught: number;
}

export interface GameState {
  readonly schemaVersion: number;
  readonly gameVersion: string;
  readonly createdAt: number;
  readonly lastSavedAt: number;
  readonly rngStreams: RngStreamStates;
  readonly player: PlayerState;
  readonly world: WorldState;
  /** Fino a `battle.json → party.size` esemplari. Il primo è quello che entra per primo. */
  readonly party: readonly CreatureInstance[];
  readonly archive: Readonly<Record<string, ArchiveEntry>>;
  readonly inventory: Readonly<Record<string, number>>;
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
    // La squadra parte vuota di proposito: il Ferale iniziale viene consegnato
    // dalla sessione, con lo stesso percorso che recupera un salvataggio vecchio.
    party: [],
    archive: {},
    inventory: { ...options.config.startingInventory },
    flags: {},
    stats: {
      playtimeMs: 0,
      zonesVisited: [options.config.startZoneId],
      battlesWon: 0,
      creaturesCaught: 0,
    },
  };
}

export function archiveWith(
  archive: Readonly<Record<string, ArchiveEntry>>,
  speciesId: string,
  change: { readonly seen?: boolean; readonly caught?: number },
): Record<string, ArchiveEntry> {
  const current = archive[speciesId] ?? { seen: false, caught: 0 };
  return {
    ...archive,
    [speciesId]: {
      seen: change.seen ?? current.seen,
      caught: current.caught + (change.caught ?? 0),
    },
  };
}
