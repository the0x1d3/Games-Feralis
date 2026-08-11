import tilesData from '@data/world/tiles.json';
import worldData from '@data/world/world.json';
import { parseWorldConfig, type WorldConfig } from '@domain/world/config';
import { parseTileRules, parseZone } from '@domain/world/tiled';
import type { Zone } from '@domain/world/zone';

/**
 * Caricamento del mondo, secondo l'ADR 0003: i dati piccoli e sempre
 * necessari arrivano con un import statico, le mappe con un import dinamico
 * cosi' ognuna diventa un chunk a parte e non pesa sul primo caricamento.
 *
 * Gli importatori sono elencati uno per uno e non costruiti da una stringa:
 * e' l'unico modo perche' Vite li veda e li sappia dividere.
 */

const MAP_LOADERS: Readonly<Record<string, () => Promise<{ default: unknown }>>> = {
  costa: () => import('@data/maps/costa.json'),
  bosco: () => import('@data/maps/bosco.json'),
  altopiano: () => import('@data/maps/altopiano.json'),
};

export const ZONE_IDS: readonly string[] = Object.keys(MAP_LOADERS);

export interface LoadedWorld {
  readonly config: WorldConfig;
  readonly zones: ReadonlyMap<string, Zone>;
  /** Il JSON grezzo, che serve a Phaser per disegnare i layer. */
  readonly rawMaps: ReadonlyMap<string, unknown>;
}

export async function loadWorld(): Promise<LoadedWorld> {
  const config = parseWorldConfig(worldData);
  const rules = parseTileRules(tilesData);

  const zones = new Map<string, Zone>();
  const rawMaps = new Map<string, unknown>();

  const entries = await Promise.all(
    Object.entries(MAP_LOADERS).map(async ([id, load]) => {
      const module = await load();
      return [id, module.default] as const;
    }),
  );

  for (const [id, raw] of entries) {
    rawMaps.set(id, raw);
    zones.set(id, parseZone(raw, id, rules));
  }

  return { config, zones, rawMaps };
}
