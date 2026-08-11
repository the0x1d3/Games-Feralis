/**
 * Schemi Zod e controlli di integrita' referenziale per `/data`.
 *
 * Verificano cose che il gioco a runtime da' per scontate (ADR 0003): che i
 * layer esistano, che i gid stiano dentro il tileset, che ogni chiave i18n
 * citata da una mappa esista davvero. Un cartello che rimanda a una chiave
 * inesistente non fa crashare nulla: mostra il nome della chiave al giocatore,
 * ed e' il tipo di errore che arriva in produzione perche' nessuno rilegge
 * tutti i cartelli prima di ogni release.
 */
import { z } from 'zod';

export const tilesSchema = z.object({
  tileSize: z.number().int().positive(),
  tilesetName: z.string().min(1),
  columns: z.number().int().positive(),
  tiles: z
    .array(
      z.object({
        id: z.number().int().min(0),
        key: z.string().min(1),
        solid: z.boolean(),
        clearedBy: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

const ambientSchema = z.object({
  hour: z.number().min(0).max(24),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colore nella forma "#rrggbb"'),
  alpha: z.number().min(0).max(1),
});

export const worldSchema = z.object({
  startZoneId: z.string().min(1),
  startSpawn: z.string().min(1),
  time: z.object({
    dayLengthRealMs: z.number().int().positive(),
    startHour: z.number().min(0).max(24),
    dawnStartHour: z.number().min(0).max(24),
    dayStartHour: z.number().min(0).max(24),
    duskStartHour: z.number().min(0).max(24),
    nightStartHour: z.number().min(0).max(24),
    ambient: z.array(ambientSchema).min(2),
  }),
  player: z.object({
    speedTilesPerSecond: z.number().positive(),
    bodyWidth: z.number().positive(),
    bodyHeight: z.number().positive(),
    spriteOffsetY: z.number(),
  }),
  camera: z.object({ lerp: z.number().min(0).max(1) }),
  save: z.object({
    autosaveIntervalMs: z.number().int().positive(),
    offlineCapMs: z.number().int().positive(),
  }),
});

const propertySchema = z.object({ name: z.string(), value: z.unknown() });

const tileLayerSchema = z.object({
  name: z.string(),
  type: z.literal('tilelayer'),
  data: z.array(z.number().int().min(0)),
});

const objectLayerSchema = z.object({
  name: z.string(),
  type: z.literal('objectgroup'),
  objects: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
      properties: z.array(propertySchema).optional(),
    }),
  ),
});

export const mapSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  properties: z.array(propertySchema),
  tilesets: z.array(z.object({ name: z.string(), firstgid: z.number().int() })).min(1),
  layers: z.array(z.union([tileLayerSchema, objectLayerSchema])),
});

export type ParsedMap = z.infer<typeof mapSchema>;
export type ParsedTiles = z.infer<typeof tilesSchema>;

const REQUIRED_LAYERS = ['ground', 'decor', 'over'] as const;

function propertyValue(
  properties: ReadonlyArray<{ name: string; value: unknown }> | undefined,
  name: string,
): string | undefined {
  const found = properties?.find((entry) => entry.name === name);
  return found === undefined ? undefined : String(found.value);
}

export interface MapCheckInput {
  readonly id: string;
  readonly map: ParsedMap;
  readonly tiles: ParsedTiles;
  /** Chiavi presenti nella lingua di riferimento. */
  readonly translationKeys: ReadonlySet<string>;
  /** Id delle mappe esistenti in data/maps. */
  readonly knownZones: ReadonlySet<string>;
}

/** Nomi dei punti di comparsa dichiarati da una mappa. */
export function spawnNames(map: ParsedMap): Set<string> {
  const names = new Set<string>();
  for (const layer of map.layers) {
    if (layer.type !== 'objectgroup') continue;
    for (const object of layer.objects) {
      if (object.type === 'spawn') names.add(object.name);
    }
  }
  return names;
}

/** Tutti gli errori di una mappa, non solo il primo: si correggono in una volta. */
export function checkMap(
  input: MapCheckInput,
  spawnsByZone: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const errors: string[] = [];
  const { id, map, tiles } = input;
  const expectedCells = map.width * map.height;
  const maxGid = tiles.tiles.length;

  if (map.tilewidth !== tiles.tileSize || map.tileheight !== tiles.tileSize) {
    errors.push(
      `${id}: tile ${map.tilewidth}x${map.tileheight}, ma tiles.json dice ${tiles.tileSize}`,
    );
  }

  const tileLayers = new Map(
    map.layers.filter((layer) => layer.type === 'tilelayer').map((layer) => [layer.name, layer]),
  );

  for (const name of REQUIRED_LAYERS) {
    const layer = tileLayers.get(name);
    if (layer === undefined) {
      errors.push(`${id}: manca il layer "${name}"`);
      continue;
    }
    if (layer.data.length !== expectedCells) {
      errors.push(
        `${id}/${name}: ${layer.data.length} caselle invece di ${expectedCells} (${map.width}x${map.height})`,
      );
    }
    const outOfRange = layer.data.find((gid) => gid > maxGid);
    if (outOfRange !== undefined) {
      errors.push(`${id}/${name}: gid ${outOfRange} fuori dal tileset (massimo ${maxGid})`);
    }
  }

  const nameKey = propertyValue(map.properties, 'nameKey');
  if (nameKey === undefined) {
    errors.push(`${id}: manca la proprieta di mappa "nameKey"`);
  } else if (!input.translationKeys.has(nameKey)) {
    errors.push(`${id}: nameKey "${nameKey}" non esiste fra le traduzioni`);
  }

  for (const layer of map.layers) {
    if (layer.type !== 'objectgroup') continue;
    for (const object of layer.objects) {
      if (object.type === 'sign') {
        const textKey = propertyValue(object.properties, 'textKey');
        if (textKey === undefined) {
          errors.push(`${id}: un cartello e senza textKey`);
        } else if (!input.translationKeys.has(textKey)) {
          errors.push(`${id}: cartello con textKey "${textKey}" inesistente fra le traduzioni`);
        }
      }

      if (object.type === 'exit') {
        const toZone = propertyValue(object.properties, 'toZone');
        const toSpawn = propertyValue(object.properties, 'toSpawn');
        if (toZone === undefined || toSpawn === undefined) {
          errors.push(`${id}: un'uscita e senza toZone/toSpawn`);
          continue;
        }
        if (!input.knownZones.has(toZone)) {
          errors.push(`${id}: uscita verso la zona "${toZone}", che non esiste`);
          continue;
        }
        if (spawnsByZone.get(toZone)?.has(toSpawn) !== true) {
          errors.push(
            `${id}: uscita verso "${toZone}:${toSpawn}", ma quel punto di comparsa non c'e`,
          );
        }
      }
    }
  }

  return errors;
}

/** L'ambiente deve coprire l'intera giornata, altrimenti la luce salta a mezzanotte. */
export function checkAmbient(frames: ReadonlyArray<{ hour: number }>): string[] {
  const errors: string[] = [];
  const first = frames[0];
  const last = frames[frames.length - 1];

  if (first?.hour !== 0) errors.push('world.json: il primo fotogramma di ambient deve stare a 0');
  if (last?.hour !== 24) errors.push('world.json: l ultimo fotogramma di ambient deve stare a 24');

  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1];
    const current = frames[i];
    if (previous !== undefined && current !== undefined && current.hour <= previous.hour) {
      errors.push(
        `world.json: ambient non ordinato all indice ${i} (${current.hour} dopo ${previous.hour})`,
      );
    }
  }

  return errors;
}
