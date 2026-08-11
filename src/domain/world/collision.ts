import type { CollisionGrid } from './zone';

/**
 * Collisione contro griglia di tile, con risoluzione ad assi separati.
 *
 * E' logica pura, quindi non usa il sistema fisico di Phaser. Non e' purismo:
 * il PDR §7.1 impone un tick a passo fisso e il §5.4 chiede che la stessa
 * simulazione giri anche offline, cose che un motore fisico legato al
 * framerate non puo' garantire. Qui invece lo stesso input produce sempre lo
 * stesso risultato, e i test girano in millisecondi.
 *
 * Il corpo del personaggio e' un rettangolo centrato su (x, y), piu' piccolo
 * dello sprite e collocato ai piedi: e' la convenzione dei giochi top-down, e
 * fa sembrare che il personaggio cammini "dietro" agli ostacoli.
 */

/** Margine per non restare incastrati esattamente sul bordo di un tile. */
const EPSILON = 0.001;

export function isSolidTile(grid: CollisionGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.solid[ty * grid.width + tx] === 1;
}

/** Intervallo di indici di tile toccati da un segmento [min, max) in pixel. */
function tileSpan(min: number, max: number, tileSize: number): readonly [number, number] {
  return [Math.floor(min / tileSize), Math.floor((max - EPSILON) / tileSize)];
}

function anySolidInColumn(grid: CollisionGrid, tx: number, ty0: number, ty1: number): boolean {
  for (let ty = ty0; ty <= ty1; ty += 1) {
    if (isSolidTile(grid, tx, ty)) return true;
  }
  return false;
}

function anySolidInRow(grid: CollisionGrid, ty: number, tx0: number, tx1: number): boolean {
  for (let tx = tx0; tx <= tx1; tx += 1) {
    if (isSolidTile(grid, tx, ty)) return true;
  }
  return false;
}

export interface Body {
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export interface Position {
  readonly x: number;
  readonly y: number;
}

/** Vero se il corpo, centrato in (x, y), sovrappone un tile solido. */
export function overlapsSolid(grid: CollisionGrid, x: number, y: number, body: Body): boolean {
  const [tx0, tx1] = tileSpan(x - body.halfWidth, x + body.halfWidth, grid.tileSize);
  const [ty0, ty1] = tileSpan(y - body.halfHeight, y + body.halfHeight, grid.tileSize);
  for (let ty = ty0; ty <= ty1; ty += 1) {
    if (anySolidInRow(grid, ty, tx0, tx1)) return true;
  }
  return false;
}

/**
 * Sposta il corpo di (dx, dy) fermandolo contro i tile solidi.
 *
 * Gli assi si risolvono separatamente, ed e' quello che permette di
 * "scivolare" lungo un muro invece di incollarcisi: se X e' bloccato, Y puo'
 * comunque avanzare.
 */
export function moveWithCollision(
  grid: CollisionGrid,
  from: Position,
  dx: number,
  dy: number,
  body: Body,
): Position {
  const tileSize = grid.tileSize;

  // Nessuno spostamento puo' superare un tile in un singolo passo, altrimenti
  // si attraverserebbe un muro senza mai toccarlo. A 4.2 tile/s con tick da
  // 100 ms si percorrono 0.42 tile: il limite non si tocca mai, ma un domani
  // una creatura cavalcabile molto veloce potrebbe.
  const limit = tileSize - EPSILON;
  const stepX = Math.max(-limit, Math.min(limit, dx));
  const stepY = Math.max(-limit, Math.min(limit, dy));

  let x = from.x;
  const y = from.y;

  if (stepX !== 0) {
    const candidate = x + stepX;
    const [ty0, ty1] = tileSpan(y - body.halfHeight, y + body.halfHeight, tileSize);
    if (stepX > 0) {
      const tx = Math.floor((candidate + body.halfWidth - EPSILON) / tileSize);
      x = anySolidInColumn(grid, tx, ty0, ty1)
        ? tx * tileSize - body.halfWidth - EPSILON
        : candidate;
    } else {
      const tx = Math.floor((candidate - body.halfWidth) / tileSize);
      x = anySolidInColumn(grid, tx, ty0, ty1)
        ? (tx + 1) * tileSize + body.halfWidth + EPSILON
        : candidate;
    }
  }

  let nextY = y;
  if (stepY !== 0) {
    const candidate = y + stepY;
    const [tx0, tx1] = tileSpan(x - body.halfWidth, x + body.halfWidth, tileSize);
    if (stepY > 0) {
      const ty = Math.floor((candidate + body.halfHeight - EPSILON) / tileSize);
      nextY = anySolidInRow(grid, ty, tx0, tx1)
        ? ty * tileSize - body.halfHeight - EPSILON
        : candidate;
    } else {
      const ty = Math.floor((candidate - body.halfHeight) / tileSize);
      nextY = anySolidInRow(grid, ty, tx0, tx1)
        ? (ty + 1) * tileSize + body.halfHeight + EPSILON
        : candidate;
    }
  }

  return { x, y: nextY };
}

export function tileAt(grid: CollisionGrid, x: number, y: number): { tx: number; ty: number } {
  return { tx: Math.floor(x / grid.tileSize), ty: Math.floor(y / grid.tileSize) };
}
