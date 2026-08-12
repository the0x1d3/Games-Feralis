import { clearedFlag, collisionWithObstacles, obstaclesOf } from '@domain/world/obstacles';
import type { CollisionGrid, Zone } from '@domain/world/zone';

/**
 * La griglia di collisione con gli ostacoli già rimossi, memoizzata.
 *
 * `collisionWithObstacles` è pura e copia un Uint8Array: costa poco, ma il tick
 * gira dieci volte al secondo e chiamarla ogni volta sarebbe lavoro buttato.
 * Qui si tiene una copia per combinazione (zona, ostacoli rimossi).
 *
 * La cache sta in `src/state/` e non nel dominio apposta: è memoria mutabile, e
 * il dominio non ne ha. Resta comunque una funzione pura vista da fuori — gli
 * stessi argomenti danno sempre lo stesso risultato — quindi non cambia il
 * comportamento del riduttore, solo il suo costo.
 */

const cache = new WeakMap<Zone, Map<string, CollisionGrid>>();

function signature(zone: Zone, flags: Readonly<Record<string, boolean>>): string {
  return obstaclesOf(zone)
    .filter((obstacle) => flags[clearedFlag(zone.id, obstacle.id)] === true)
    .map((obstacle) => obstacle.id)
    .sort()
    .join(',');
}

export function collisionFor(
  zone: Zone,
  flags: Readonly<Record<string, boolean>>,
): CollisionGrid {
  const key = signature(zone, flags);
  if (key === '') return zone.collision;

  let byZone = cache.get(zone);
  if (byZone === undefined) {
    byZone = new Map<string, CollisionGrid>();
    cache.set(zone, byZone);
  }

  const hit = byZone.get(key);
  if (hit !== undefined) return hit;

  const grid = collisionWithObstacles(zone, flags);
  byZone.set(key, grid);
  return grid;
}
