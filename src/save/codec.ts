import { asNumber, asRecord, asString } from '@domain/guards';
import { RNG_STREAM_NAMES, type RngStreamStates } from '@domain/rng';
import { FACINGS, type Facing } from '@domain/world/zone';
import { SCHEMA_VERSION, type GameState } from '@state/gameState';
import { migrate, type Migration, type RawSave } from '@state/migrations';
import { crc32Hex } from './checksum';

/**
 * Serializzazione del salvataggio e codice di esportazione.
 *
 * Due formati, due scopi:
 *  - JSON semplice per lo storage locale: deve essere ispezionabile a mano
 *    quando qualcosa va storto;
 *  - stringa compatta con checksum per l'export: deve sopravvivere a un
 *    copia-incolla in una chat.
 */

const EXPORT_PREFIX = 'FRL1';

/* --------------------------------------------------------------- lettura */

function readFacing(value: unknown): Facing {
  return typeof value === 'string' && (FACINGS as readonly string[]).includes(value)
    ? (value as Facing)
    : 'down';
}

function readStreams(value: unknown): RngStreamStates {
  const record = typeof value === 'object' && value !== null ? (value as RawSave) : {};
  const streams = {} as Record<string, number>;
  for (const name of RNG_STREAM_NAMES) {
    const state = record[name];
    // Se manca, si riparte da 0: si perde la posizione nello stream, non la partita.
    streams[name] = typeof state === 'number' && Number.isFinite(state) ? state >>> 0 : 0;
  }
  return streams as RngStreamStates;
}

function readFlags(value: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (typeof value !== 'object' || value === null) return result;
  for (const [key, raw] of Object.entries(value as RawSave)) {
    if (typeof raw === 'boolean') result[key] = raw;
  }
  return result;
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Da salvataggio grezzo a stato tipizzato.
 *
 * Tollerante di proposito: i campi accessori mancanti prendono un default,
 * perche' un salvataggio recuperato a meta' vale infinitamente piu' di uno
 * rifiutato. Restano obbligatori solo i campi senza i quali la partita non
 * esiste: la zona e la posizione del giocatore.
 */
export function readGameState(raw: RawSave): GameState {
  const player = asRecord(raw['player'], 'salvataggio.player');
  const world =
    typeof raw['world'] === 'object' && raw['world'] !== null ? (raw['world'] as RawSave) : {};
  const stats =
    typeof raw['stats'] === 'object' && raw['stats'] !== null ? (raw['stats'] as RawSave) : {};

  return {
    schemaVersion: readNumber(raw['schemaVersion'], SCHEMA_VERSION),
    gameVersion: typeof raw['gameVersion'] === 'string' ? raw['gameVersion'] : 'sconosciuta',
    createdAt: readNumber(raw['createdAt'], 0),
    lastSavedAt: readNumber(raw['lastSavedAt'], 0),
    rngStreams: readStreams(raw['rngStreams']),
    player: {
      zoneId: asString(player['zoneId'], 'salvataggio.player.zoneId'),
      x: asNumber(player['x'], 'salvataggio.player.x'),
      y: asNumber(player['y'], 'salvataggio.player.y'),
      facing: readFacing(player['facing']),
    },
    world: { gameTimeMs: readNumber(world['gameTimeMs'], 0) },
    flags: readFlags(raw['flags']),
    stats: {
      playtimeMs: readNumber(stats['playtimeMs'], 0),
      zonesVisited: readStrings(stats['zonesVisited']),
    },
  };
}

/* ------------------------------------------------------------ JSON locale */

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(
  text: string,
  migrations?: Readonly<Record<number, Migration>>,
): GameState {
  const parsed: unknown = JSON.parse(text);
  const raw = asRecord(parsed, 'salvataggio');
  const migrated = migrate(raw, migrations);
  return readGameState(migrated.save);
}

/* ------------------------------------------------- codice di esportazione */

/**
 * TypeScript 5.9 distingue `Uint8Array<ArrayBuffer>` da `Uint8Array<SharedArrayBuffer>`,
 * e le API degli stream accettano solo il primo. L'alias evita di ripeterlo.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function bytesToBase64(bytes: Bytes): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * `CompressionStream` e' nativo su tutti i browser correnti, ma non su Safari
 * molto vecchi: se manca si esporta non compresso, e il marcatore nel codice
 * dice all'importatore quale dei due percorsi usare (PDR §6.4, errata E10).
 */
function hasCompression(): boolean {
  return typeof CompressionStream === 'function' && typeof Response === 'function';
}

async function pipe(
  bytes: Bytes,
  transform: CompressionStream | DecompressionStream,
): Promise<Bytes> {
  const writer = transform.writable.getWriter();
  // La scrittura non si attende PRIMA della lettura: lo stream ha un buffer
  // limitato e aspettare qui bloccherebbe entrambi i lati.
  const written = (async (): Promise<void> => {
    await writer.write(bytes);
    await writer.close();
  })();

  const output = new Uint8Array(await new Response(transform.readable).arrayBuffer());
  await written;
  return output;
}

export async function toExportCode(state: GameState): Promise<string> {
  const json = new TextEncoder().encode(serialize(state));
  const compressed = hasCompression();
  const payload = compressed ? await pipe(json, new CompressionStream('deflate-raw')) : json;
  return [EXPORT_PREFIX, compressed ? 'z' : 'r', bytesToBase64(payload), crc32Hex(payload)].join(
    '.',
  );
}

export async function fromExportCode(
  code: string,
  migrations?: Readonly<Record<number, Migration>>,
): Promise<GameState> {
  const parts = code.trim().split('.');
  const [prefix, mode, payload, checksum] = parts;

  if (parts.length !== 4 || prefix !== EXPORT_PREFIX) {
    throw new Error('Codice non riconosciuto: non sembra un salvataggio di Feralis.');
  }
  if (payload === undefined || checksum === undefined) {
    throw new Error('Codice incompleto.');
  }

  const bytes = base64ToBytes(payload);
  if (crc32Hex(bytes) !== checksum) {
    throw new Error('Codice corrotto o incompleto: probabilmente e stato copiato solo in parte.');
  }

  const json = mode === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return deserialize(new TextDecoder().decode(json), migrations);
}
