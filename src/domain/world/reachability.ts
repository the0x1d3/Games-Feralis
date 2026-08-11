import { isSolidTile } from './collision';
import type { CollisionGrid } from './zone';

/**
 * Raggiungibilita' sulla griglia, con una visita in ampiezza.
 *
 * Serve a rispondere per iscritto a "si puo' davvero arrivare li'?" invece che
 * camminando a mano dopo ogni modifica alla mappa. In Fase 5 la stessa
 * funzione reggera' il test anti-deadlock dell'albero tecnologico (PDR §8).
 *
 * La visita e' a 4 direzioni anche se il movimento e' a 8: e' la scelta
 * prudente, perche' un passaggio che si apre solo in diagonale fra due spigoli
 * e' esattamente il tipo di percorso che il giocatore non trova.
 */

export interface TileCoord {
  readonly tx: number;
  readonly ty: number;
}

const NEIGHBOURS: readonly TileCoord[] = [
  { tx: 1, ty: 0 },
  { tx: -1, ty: 0 },
  { tx: 0, ty: 1 },
  { tx: 0, ty: -1 },
];

/** Indici delle caselle raggiungibili a piedi partendo da `start`. */
export function reachableTiles(grid: CollisionGrid, start: TileCoord): Set<number> {
  const seen = new Set<number>();
  if (isSolidTile(grid, start.tx, start.ty)) return seen;

  const queue: TileCoord[] = [start];
  seen.add(start.ty * grid.width + start.tx);

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;

    for (const step of NEIGHBOURS) {
      const tx = current.tx + step.tx;
      const ty = current.ty + step.ty;
      const index = ty * grid.width + tx;
      if (seen.has(index) || isSolidTile(grid, tx, ty)) continue;
      seen.add(index);
      queue.push({ tx, ty });
    }
  }

  return seen;
}

export function isReachable(grid: CollisionGrid, from: TileCoord, to: TileCoord): boolean {
  return reachableTiles(grid, from).has(to.ty * grid.width + to.tx);
}
