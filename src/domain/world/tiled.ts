import { asArray, asNumber, asRecord, asString } from '../guards';
import {
  buildCollisionGrid,
  type TileRule,
  type TileRules,
  type Zone,
  type ZoneLayers,
  type ZoneObject,
} from './zone';

/**
 * Lettore di mappe in formato Tiled.
 *
 * Legge da `unknown` con controlli espliciti invece di fidarsi di un cast: i
 * file mappa sono validati in CI (ADR 0003), ma un lettore che spiega cosa
 * manca costa poco e trasforma un "undefined is not an object" a runtime in un
 * messaggio che dice quale layer e' assente.
 *
 * Non usa Zod di proposito: Zod resta una dipendenza di sviluppo, non un peso
 * che ogni giocatore scarica per ricontrollare dati gia' verificati.
 */

/** Le proprieta' di Tiled sono una lista di { name, value }: qui diventa una mappa. */
function readProperties(raw: unknown, what: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  if (raw === undefined) return result;
  for (const entry of asArray(raw, `${what}.properties`)) {
    const record = asRecord(entry, `${what}.properties[]`);
    result.set(asString(record['name'], `${what}.properties[].name`), String(record['value']));
  }
  return result;
}

function readTileLayer(raw: unknown, name: string, expectedSize: number): number[] {
  const record = asRecord(raw, `layer "${name}"`);
  const data = asArray(record['data'], `layer "${name}".data`);
  if (data.length !== expectedSize) {
    throw new RangeError(
      `layer "${name}": ${data.length} caselle invece di ${expectedSize} (larghezza x altezza)`,
    );
  }
  // Tiled usa gid 1-based e 0 per "vuoto"; internamente lavoriamo con indici
  // 0-based e -1 per "vuoto", cosi' il tile 0 non e' ambiguo.
  return data.map((gid, index) => asNumber(gid, `layer "${name}".data[${index}]`) - 1);
}

function readObject(raw: unknown, index: number): ZoneObject | undefined {
  const record = asRecord(raw, `objects[${index}]`);
  const type = asString(record['type'] ?? '', `objects[${index}].type`);
  const x = asNumber(record['x'], `objects[${index}].x`);
  const y = asNumber(record['y'], `objects[${index}].y`);
  const properties = readProperties(record['properties'], `objects[${index}]`);

  if (type === 'spawn') {
    return { kind: 'spawn', name: asString(record['name'], `objects[${index}].name`), x, y };
  }

  if (type === 'exit') {
    const toZone = properties.get('toZone');
    const toSpawn = properties.get('toSpawn');
    if (toZone === undefined || toSpawn === undefined) {
      throw new Error(`objects[${index}]: un'uscita richiede le proprieta' toZone e toSpawn`);
    }
    return {
      kind: 'exit',
      x,
      y,
      width: asNumber(record['width'], `objects[${index}].width`),
      height: asNumber(record['height'], `objects[${index}].height`),
      toZone,
      toSpawn,
    };
  }

  if (type === 'sign') {
    const textKey = properties.get('textKey');
    if (textKey === undefined) {
      throw new Error(`objects[${index}]: un cartello richiede la proprieta' textKey`);
    }
    return { kind: 'sign', x, y, textKey };
  }

  // Un tipo sconosciuto non e' un errore fatale: Tiled permette di annotare la
  // mappa con oggetti che al gioco non servono.
  return undefined;
}

export function parseTileRules(raw: unknown): TileRules {
  const record = asRecord(raw, 'tiles.json');
  const tileSize = asNumber(record['tileSize'], 'tiles.json.tileSize');
  const byId = new Map<number, TileRule>();

  for (const [index, entry] of asArray(record['tiles'], 'tiles.json.tiles').entries()) {
    const tile = asRecord(entry, `tiles.json.tiles[${index}]`);
    const id = asNumber(tile['id'], `tiles.json.tiles[${index}].id`);
    const clearedBy = tile['clearedBy'];
    byId.set(id, {
      id,
      key: asString(tile['key'], `tiles.json.tiles[${index}].key`),
      solid: tile['solid'] === true,
      encounter: tile['encounter'] === true,
      ...(typeof clearedBy === 'string' ? { clearedBy } : {}),
    });
  }

  return { tileSize, byId };
}

export function parseZone(raw: unknown, id: string, rules: TileRules): Zone {
  const map = asRecord(raw, `mappa "${id}"`);
  const width = asNumber(map['width'], `mappa "${id}".width`);
  const height = asNumber(map['height'], `mappa "${id}".height`);
  const tileSize = asNumber(map['tilewidth'], `mappa "${id}".tilewidth`);

  if (tileSize !== rules.tileSize) {
    throw new RangeError(
      `mappa "${id}": tile da ${tileSize}px, ma data/world/tiles.json ne dichiara ${rules.tileSize}px`,
    );
  }

  const named = new Map<string, unknown>();
  let objectsRaw: unknown[] = [];

  for (const layer of asArray(map['layers'], `mappa "${id}".layers`)) {
    const record = asRecord(layer, `mappa "${id}".layers[]`);
    const name = asString(record['name'], `mappa "${id}".layers[].name`);
    if (record['type'] === 'objectgroup') {
      objectsRaw = asArray(record['objects'], `mappa "${id}".${name}.objects`);
    } else {
      named.set(name, layer);
    }
  }

  const size = width * height;
  const layers: ZoneLayers = {
    ground: readTileLayer(named.get('ground'), 'ground', size),
    decor: readTileLayer(named.get('decor'), 'decor', size),
    over: readTileLayer(named.get('over'), 'over', size),
  };

  const objects: ZoneObject[] = [];
  objectsRaw.forEach((entry, index) => {
    const parsed = readObject(entry, index);
    if (parsed !== undefined) objects.push(parsed);
  });

  const nameKey = readProperties(map['properties'], `mappa "${id}"`).get('nameKey');
  if (nameKey === undefined) {
    throw new Error(`mappa "${id}": manca la proprieta' di mappa "nameKey"`);
  }

  return {
    id,
    nameKey,
    width,
    height,
    tileSize,
    layers,
    objects,
    collision: buildCollisionGrid(width, height, layers, rules),
  };
}
