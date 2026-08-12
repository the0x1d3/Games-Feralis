import type { CreatureInstance } from '../creature/instance';
import type { Species } from '../creature/species';
import { tileInFront } from './interaction';
import type { Actor } from './movement';
import type { CollisionGrid, ObstacleObject, Zone } from './zone';

/**
 * Gli ostacoli del mondo.
 *
 * È la "regola d'oro" del PDR §4.3 resa meccanica: ogni mansione sblocca anche
 * un passaggio, quindi il Ferale che cercavi per la Radura è lo stesso che ti
 * apre il bioma successivo. Catturare per lavorare e catturare per esplorare
 * diventano la stessa attività, invece di due economie separate.
 *
 * Un ostacolo rimosso non torna: lo stato è una bandiera nel salvataggio, e la
 * griglia di collisione ne è la conseguenza calcolata, non una seconda verità
 * da tenere allineata.
 */

export type ClearRefusal = 'noCreature' | 'wrongWork' | 'lowLevel' | 'missingItem' | 'fainted';

export interface ClearCheck {
  readonly ok: boolean;
  readonly refusal?: ClearRefusal;
  /** Chi lo rimuove: serve alla UI per dire "Rugiadello sposta il masso". */
  readonly by?: CreatureInstance;
}

/** La chiave della bandiera nel salvataggio. Immutabile come un id di /data. */
export function clearedFlag(zoneId: string, obstacleId: string): string {
  return `cleared.${zoneId}.${obstacleId}`;
}

export function isCleared(
  flags: Readonly<Record<string, boolean>>,
  zoneId: string,
  obstacleId: string,
): boolean {
  return flags[clearedFlag(zoneId, obstacleId)] === true;
}

export function obstaclesOf(zone: Zone): ObstacleObject[] {
  return zone.objects.filter((object): object is ObstacleObject => object.kind === 'obstacle');
}

/** L'ostacolo che il giocatore ha davanti, se non è già stato rimosso. */
export function facingObstacle(
  zone: Zone,
  actor: Actor,
  flags: Readonly<Record<string, boolean>>,
): ObstacleObject | undefined {
  const tile = tileInFront(actor, zone.tileSize);

  for (const obstacle of obstaclesOf(zone)) {
    if (isCleared(flags, zone.id, obstacle.id)) continue;
    const hit = obstacleTiles(zone, obstacle).some(
      (entry) => entry.tx === tile.tx && entry.ty === tile.ty,
    );
    if (hit) return obstacle;
  }

  return undefined;
}

/**
 * Chi, fra i Ferali in squadra, può togliere questo ostacolo.
 *
 * Guarda la **squadra** e non il deposito: portarsi dietro lo specialista è la
 * decisione, e sarebbe svuotata se bastasse averlo da qualche parte. Un Ferale
 * a terra non lavora, qui come alla Radura.
 */
export function canClear(
  obstacle: ObstacleObject,
  party: readonly CreatureInstance[],
  species: ReadonlyMap<string, Species>,
  inventory: Readonly<Record<string, number>>,
): ClearCheck {
  if (obstacle.requiresItem !== undefined && (inventory[obstacle.requiresItem] ?? 0) <= 0) {
    return { ok: false, refusal: 'missingItem' };
  }

  let best: ClearRefusal = 'wrongWork';

  for (const creature of party) {
    const entry = species.get(creature.speciesId);
    if (entry === undefined) continue;

    const level = entry.work[obstacle.work as keyof typeof entry.work] ?? 0;
    if (level <= 0) continue;
    if (level < obstacle.level) {
      best = 'lowLevel';
      continue;
    }
    if (creature.hp <= 0) {
      best = 'fainted';
      continue;
    }
    return { ok: true, by: creature };
  }

  return { ok: false, refusal: party.length === 0 ? 'noCreature' : best };
}

/**
 * La griglia di collisione con gli ostacoli ancora in piedi.
 *
 * Restituisce la griglia originale quando non c'è nulla da aggiungere, così il
 * caso comune non copia nulla. È una funzione pura: la griglia della zona non
 * viene mai modificata, perché una collisione che cambia sotto ai piedi di chi
 * la legge è il tipo di bug che si manifesta una volta ogni cento partite.
 */
export function collisionWithObstacles(
  zone: Zone,
  flags: Readonly<Record<string, boolean>>,
): CollisionGrid {
  const cleared = obstaclesOf(zone).filter((obstacle) => isCleared(flags, zone.id, obstacle.id));
  // Gli ostacoli in piedi sono gia' solidi per via del loro tile: finche' non
  // se ne rimuove nessuno non c'e' niente da ricalcolare, e il caso comune
  // (nessun ostacolo tolto) non copia un byte.
  if (cleared.length === 0) return zone.collision;

  const solid = Uint8Array.from(zone.collision.solid);
  for (const obstacle of cleared) {
    for (const tile of obstacleTiles(zone, obstacle)) {
      solid[tile.ty * zone.collision.width + tile.tx] = 0;
    }
  }

  return { ...zone.collision, solid };
}

/** Le caselle occupate da un ostacolo, gia' ritagliate dentro la mappa. */
export function obstacleTiles(
  zone: Zone,
  obstacle: ObstacleObject,
): Array<{ tx: number; ty: number }> {
  const tiles: Array<{ tx: number; ty: number }> = [];
  const tx = Math.floor(obstacle.x / zone.tileSize);
  const ty = Math.floor(obstacle.y / zone.tileSize);
  const tw = Math.max(1, Math.round(obstacle.width / zone.tileSize));
  const th = Math.max(1, Math.round(obstacle.height / zone.tileSize));

  for (let y = ty; y < ty + th; y += 1) {
    for (let x = tx; x < tx + tw; x += 1) {
      if (x < 0 || y < 0 || x >= zone.width || y >= zone.height) continue;
      tiles.push({ tx: x, ty: y });
    }
  }
  return tiles;
}

/** Gli ostacoli gia' rimossi: la scena ci ridisegna sopra il terreno pulito. */
export function clearedObstacles(
  zone: Zone,
  flags: Readonly<Record<string, boolean>>,
): ObstacleObject[] {
  return obstaclesOf(zone).filter((obstacle) => isCleared(flags, zone.id, obstacle.id));
}
