import { del, get, set } from 'idb-keyval';
import type { GameState } from '@state/gameState';
import { deserialize, serialize } from './codec';

/**
 * Persistenza locale.
 *
 * Due impegni del PDR §7.4 sono cablati qui:
 *
 *  - **doppia scrittura**: prima di sovrascrivere lo slot, il contenuto
 *    precedente diventa il backup. Se il gioco muore a meta' scrittura resta
 *    sempre una partita valida da cui ripartire;
 *  - **IndexedDB con ripiego su localStorage**: in Safari privato IndexedDB
 *    puo' non esserci, e il gioco deve degradare con un avviso, non con uno
 *    schermo nero.
 */

export type SlotId = 1 | 2 | 3;

export const SLOTS: readonly SlotId[] = [1, 2, 3];

export type StorageKind = 'indexeddb' | 'localstorage';

function mainKey(slot: SlotId): string {
  return `feralis/save/slot-${slot}`;
}

function backupKey(slot: SlotId): string {
  return `feralis/save/slot-${slot}.backup`;
}

let detected: StorageKind | undefined;

/** Una scrittura vera di prova: la sola presenza di `indexedDB` non basta. */
async function detectStorage(): Promise<StorageKind> {
  if (detected !== undefined) return detected;
  try {
    await set('feralis/probe', '1');
    await del('feralis/probe');
    detected = 'indexeddb';
  } catch {
    detected = 'localstorage';
  }
  return detected;
}

export function storageKind(): StorageKind | undefined {
  return detected;
}

async function readRaw(key: string): Promise<string | undefined> {
  if ((await detectStorage()) === 'indexeddb') {
    const value = await get<string>(key);
    return typeof value === 'string' ? value : undefined;
  }
  return localStorage.getItem(key) ?? undefined;
}

async function writeRaw(key: string, value: string): Promise<void> {
  if ((await detectStorage()) === 'indexeddb') {
    await set(key, value);
    return;
  }
  localStorage.setItem(key, value);
}

export interface LoadResult {
  readonly state: GameState;
  /** Vero se lo slot principale era illeggibile e si e' usato il backup. */
  readonly fromBackup: boolean;
}

export async function saveGame(slot: SlotId, state: GameState): Promise<void> {
  const previous = await readRaw(mainKey(slot));
  if (previous !== undefined) await writeRaw(backupKey(slot), previous);
  await writeRaw(mainKey(slot), serialize(state));
}

export async function loadGame(slot: SlotId): Promise<LoadResult | undefined> {
  const primary = await readRaw(mainKey(slot));
  if (primary !== undefined) {
    try {
      return { state: deserialize(primary), fromBackup: false };
    } catch {
      // Si passa al backup invece di arrendersi: e' esattamente il caso per cui esiste.
    }
  }

  const backup = await readRaw(backupKey(slot));
  if (backup === undefined) return undefined;

  try {
    return { state: deserialize(backup), fromBackup: true };
  } catch {
    return undefined;
  }
}

export async function hasSave(slot: SlotId): Promise<boolean> {
  return (await readRaw(mainKey(slot))) !== undefined;
}

export async function deleteSave(slot: SlotId): Promise<void> {
  if ((await detectStorage()) === 'indexeddb') {
    await del(mainKey(slot));
    await del(backupKey(slot));
    return;
  }
  localStorage.removeItem(mainKey(slot));
  localStorage.removeItem(backupKey(slot));
}
