import type { Species } from '../creature/species';
import { asNumber, asRecord } from '../guards';
import type { Rng, WeightedEntry } from '../rng';

/**
 * Incontri nell'erba alta.
 *
 * La probabilità è legata alla **distanza percorsa**, non ai tick: così
 * camminare lentamente non è un modo di evitare gli incontri, e la frequenza
 * non cambia se un giorno il tick cambiasse durata. È anche il motivo per cui
 * non serve tenere un contatore di passi nel salvataggio.
 *
 * Questo è il primo consumatore vero del RNG seeded: da qui in poi lo stato
 * dello stream `world` dentro il salvataggio smette di essere teorico, ed è
 * quello che rende una partita ripercorribile da un seme.
 */

export interface LevelRange {
  readonly min: number;
  readonly max: number;
}

export interface EncounterConfig {
  /** Probabilità di incontro ogni `stepDistancePx` percorsi nell'erba alta. */
  readonly chancePerStep: number;
  readonly stepDistancePx: number;
  readonly alphaChance: number;
  readonly levelByBiome: Readonly<Record<string, LevelRange>>;
}

export function parseEncounterConfig(raw: unknown): EncounterConfig {
  const root = asRecord(raw, 'encounters.json');
  const levels = asRecord(root['levelByBiome'], 'encounters.json.levelByBiome');
  const levelByBiome: Record<string, LevelRange> = {};

  for (const [biome, value] of Object.entries(levels)) {
    const range = asRecord(value, `encounters.json.levelByBiome.${biome}`);
    levelByBiome[biome] = {
      min: asNumber(range['min'], `encounters.json.levelByBiome.${biome}.min`),
      max: asNumber(range['max'], `encounters.json.levelByBiome.${biome}.max`),
    };
  }

  return {
    chancePerStep: asNumber(root['chancePerStep'], 'encounters.json.chancePerStep'),
    stepDistancePx: asNumber(root['stepDistancePx'], 'encounters.json.stepDistancePx'),
    alphaChance: asNumber(root['alphaChance'], 'encounters.json.alphaChance'),
    levelByBiome,
  };
}

/** Probabilità di incontro per una certa distanza percorsa nell'erba alta. */
export function encounterChance(distancePx: number, config: EncounterConfig): number {
  if (distancePx <= 0 || config.stepDistancePx <= 0) return 0;
  return Math.min(1, (config.chancePerStep * distancePx) / config.stepDistancePx);
}

/**
 * Le specie che possono comparire in un bioma a una certa ora.
 *
 * Le voci `timeOfDay: 'night'` esistono perché la notte cambi davvero
 * qualcosa: senza, il ciclo giorno/notte sarebbe solo una tinta sullo schermo.
 */
export function encounterTable(
  species: Iterable<Species>,
  biome: string,
  isNight: boolean,
): WeightedEntry<Species>[] {
  const table: WeightedEntry<Species>[] = [];

  for (const entry of species) {
    for (const spawn of entry.spawn) {
      if (spawn.biome !== biome) continue;
      if (spawn.timeOfDay === 'day' && isNight) continue;
      if (spawn.timeOfDay === 'night' && !isNight) continue;
      table.push({ value: entry, weight: spawn.weight });
    }
  }

  return table;
}

export interface Encounter {
  readonly species: Species;
  readonly level: number;
  readonly isAlpha: boolean;
}

export interface EncounterCheck {
  /** Distanza percorsa da quando si è controllato l'ultima volta. */
  readonly distancePx: number;
  /** Vero se il giocatore sta calpestando erba alta. */
  readonly onEncounterTile: boolean;
  readonly biome: string;
  readonly isNight: boolean;
  readonly species: Iterable<Species>;
}

/**
 * Il controllo completo, in una funzione sola.
 *
 * Sta qui e non nella scena perché è una regola di gioco: quante probabilità
 * ci sono di incontrare qualcosa, e cosa può comparire. La scena sa solo dove
 * si trova il giocatore e quanto ha camminato.
 */
export function checkEncounter(
  input: EncounterCheck,
  config: EncounterConfig,
  rng: Rng,
): Encounter | undefined {
  if (!input.onEncounterTile) return undefined;
  if (!rng.chance(encounterChance(input.distancePx, config))) return undefined;

  const table = encounterTable(input.species, input.biome, input.isNight);
  return rollEncounter(table, input.biome, config, rng);
}

/**
 * Estrae un incontro. `undefined` se in questo bioma, a quest'ora, non compare
 * nulla — una condizione legittima, non un errore.
 *
 * L'ordine delle estrazioni è parte del contratto: specie, livello, Alfa.
 */
export function rollEncounter(
  table: readonly WeightedEntry<Species>[],
  biome: string,
  config: EncounterConfig,
  rng: Rng,
): Encounter | undefined {
  if (table.length === 0) return undefined;

  const species = rng.weighted(table);
  const range = config.levelByBiome[biome] ?? { min: 1, max: 1 };
  const level = rng.int(Math.min(range.min, range.max), Math.max(range.min, range.max));
  const isAlpha = rng.chance(config.alphaChance);

  return { species, level, isAlpha };
}
