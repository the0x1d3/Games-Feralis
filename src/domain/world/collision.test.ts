import { describe, expect, it } from 'vitest';
import { isSolidTile, moveWithCollision, overlapsSolid, tileAt } from './collision';
import type { CollisionGrid } from './zone';

const TILE = 32;

/**
 * Griglia di prova 5x5: bordo pieno, un pilastro al centro.
 *
 *   # # # # #
 *   # . . . #
 *   # . # . #
 *   # . . . #
 *   # # # # #
 */
function grid(): CollisionGrid {
  const map = ['#####', '#...#', '#.#.#', '#...#', '#####'];
  const solid = new Uint8Array(25);
  map.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      solid[y * 5 + x] = cell === '#' ? 1 : 0;
    });
  });
  return { width: 5, height: 5, tileSize: TILE, solid };
}

const BODY = { halfWidth: 8, halfHeight: 6 };

/** Centro del tile (tx, ty). */
function center(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

describe('isSolidTile', () => {
  it('legge la griglia', () => {
    expect(isSolidTile(grid(), 0, 0)).toBe(true);
    expect(isSolidTile(grid(), 1, 1)).toBe(false);
    expect(isSolidTile(grid(), 2, 2)).toBe(true);
  });

  /*
   * Fuori mappa = solido. Senza questa regola ogni zona dovrebbe ricordarsi di
   * disegnare un muro perimetrale, e la prima che se ne dimentica lascia il
   * giocatore camminare nel vuoto.
   */
  it('considera solido tutto cio che sta fuori dai bordi', () => {
    expect(isSolidTile(grid(), -1, 2)).toBe(true);
    expect(isSolidTile(grid(), 5, 2)).toBe(true);
    expect(isSolidTile(grid(), 2, -1)).toBe(true);
    expect(isSolidTile(grid(), 2, 5)).toBe(true);
  });
});

describe('overlapsSolid', () => {
  it('riconosce un corpo libero e uno dentro il muro', () => {
    const g = grid();
    expect(overlapsSolid(g, center(1, 1).x, center(1, 1).y, BODY)).toBe(false);
    expect(overlapsSolid(g, center(2, 2).x, center(2, 2).y, BODY)).toBe(true);
  });
});

describe('moveWithCollision', () => {
  it('avanza liberamente in spazio aperto', () => {
    const g = grid();
    const from = center(1, 1);
    const to = moveWithCollision(g, from, 5, 0, BODY);
    expect(to.x).toBeCloseTo(from.x + 5, 6);
    expect(to.y).toBe(from.y);
  });

  it('si ferma contro il muro invece di attraversarlo', () => {
    const g = grid();
    const from = center(3, 1);
    const to = moveWithCollision(g, from, 100, 0, BODY);
    // Il muro comincia a x = 4 * 32 = 128: il bordo destro del corpo si ferma li.
    expect(to.x + BODY.halfWidth).toBeLessThanOrEqual(4 * TILE);
    expect(to.x + BODY.halfWidth).toBeGreaterThan(4 * TILE - 1);
  });

  it('si ferma anche andando a sinistra e in verticale', () => {
    const g = grid();
    const left = moveWithCollision(g, center(1, 1), -100, 0, BODY);
    expect(left.x - BODY.halfWidth).toBeGreaterThanOrEqual(TILE);

    const up = moveWithCollision(g, center(1, 1), 0, -100, BODY);
    expect(up.y - BODY.halfHeight).toBeGreaterThanOrEqual(TILE);

    const down = moveWithCollision(g, center(1, 3), 0, 100, BODY);
    expect(down.y + BODY.halfHeight).toBeLessThanOrEqual(4 * TILE);
  });

  /*
   * Il motivo per cui gli assi si risolvono separatamente: strisciare lungo un
   * muro deve funzionare, altrimenti ogni angolo diventa una trappola.
   */
  it('permette di scivolare lungo un muro bloccato su un solo asse', () => {
    const g = grid();
    const from = center(1, 1);
    const to = moveWithCollision(g, from, -100, 8, BODY);
    expect(to.x - BODY.halfWidth).toBeGreaterThanOrEqual(TILE); // X bloccata
    expect(to.y).toBeCloseTo(from.y + 8, 6); // Y libera
  });

  it('non attraversa un pilastro nemmeno con uno spostamento enorme', () => {
    const g = grid();
    const from = center(1, 2);
    const to = moveWithCollision(g, from, 10_000, 0, BODY);
    expect(overlapsSolid(g, to.x, to.y, BODY)).toBe(false);
    expect(to.x).toBeLessThan(2 * TILE);
  });

  it('lasciato fermo non muove nulla', () => {
    const g = grid();
    const from = center(1, 1);
    expect(moveWithCollision(g, from, 0, 0, BODY)).toEqual(from);
  });
});

describe('tileAt', () => {
  it('converte pixel in coordinate di tile', () => {
    expect(tileAt(grid(), 0, 0)).toEqual({ tx: 0, ty: 0 });
    expect(tileAt(grid(), 47, 80)).toEqual({ tx: 1, ty: 2 });
  });
});
