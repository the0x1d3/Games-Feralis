import { describe, expect, it } from 'vitest';
import { facingFrom, intentFrom, NO_INPUT, stepActor, type Actor } from './movement';
import type { CollisionGrid } from './zone';

const TILE = 32;

/** Campo aperto 10x10 senza ostacoli. */
function openField(): CollisionGrid {
  return { width: 10, height: 10, tileSize: TILE, solid: new Uint8Array(100) };
}

const CONFIG = {
  speedTilesPerSecond: 4,
  body: { halfWidth: 8, halfHeight: 6 },
};

const START: Actor = { x: 160, y: 160, facing: 'down', moving: false };

describe('intentFrom', () => {
  it('produce direzioni unitarie sugli assi', () => {
    expect(intentFrom({ ...NO_INPUT, right: true })).toEqual({ x: 1, y: 0 });
    expect(intentFrom({ ...NO_INPUT, up: true })).toEqual({ x: 0, y: -1 });
  });

  it('annulla gli input opposti', () => {
    expect(intentFrom({ up: true, down: true, left: true, right: true })).toEqual({ x: 0, y: 0 });
  });

  /*
   * Senza normalizzazione la diagonale sarebbe il 41% piu' veloce della linea
   * retta. I giocatori lo sentono anche quando non sanno dire cosa non va.
   */
  it('normalizza le diagonali alla stessa lunghezza degli assi', () => {
    const diagonal = intentFrom({ ...NO_INPUT, right: true, down: true });
    const length = Math.hypot(diagonal.x, diagonal.y);
    expect(length).toBeCloseTo(1, 6);
  });
});

describe('facingFrom', () => {
  it('mantiene la direzione precedente quando si sta fermi', () => {
    expect(facingFrom({ x: 0, y: 0 }, 'left')).toBe('left');
  });

  it('segue l asse dominante', () => {
    expect(facingFrom({ x: 0, y: 1 }, 'up')).toBe('down');
    expect(facingFrom({ x: -1, y: 0 }, 'up')).toBe('left');
  });

  it('in diagonale perfetta preferisce l orizzontale', () => {
    const diagonal = intentFrom({ ...NO_INPUT, right: true, up: true });
    expect(facingFrom(diagonal, 'down')).toBe('right');
  });
});

describe('stepActor', () => {
  it('percorre esattamente la distanza attesa in un secondo', () => {
    const grid = openField();
    let actor = START;
    for (let i = 0; i < 10; i += 1) {
      actor = stepActor(actor, { ...NO_INPUT, right: true }, 0.1, grid, CONFIG);
    }
    expect(actor.x - START.x).toBeCloseTo(CONFIG.speedTilesPerSecond * TILE, 6);
    expect(actor.y).toBe(START.y);
  });

  it('la diagonale copre la stessa distanza totale della linea retta', () => {
    const grid = openField();
    const straight = stepActor(START, { ...NO_INPUT, right: true }, 0.1, grid, CONFIG);
    const diagonal = stepActor(START, { ...NO_INPUT, right: true, down: true }, 0.1, grid, CONFIG);

    const straightDistance = Math.hypot(straight.x - START.x, straight.y - START.y);
    const diagonalDistance = Math.hypot(diagonal.x - START.x, diagonal.y - START.y);
    expect(diagonalDistance).toBeCloseTo(straightDistance, 6);
  });

  it('e deterministico: stesso ingresso, stessa uscita', () => {
    const grid = openField();
    const a = stepActor(START, { ...NO_INPUT, left: true, up: true }, 0.1, grid, CONFIG);
    const b = stepActor(START, { ...NO_INPUT, left: true, up: true }, 0.1, grid, CONFIG);
    expect(a).toEqual(b);
  });

  it('senza input resta fermo e conserva la direzione', () => {
    const grid = openField();
    const actor = stepActor({ ...START, facing: 'left' }, NO_INPUT, 0.1, grid, CONFIG);
    expect(actor.x).toBe(START.x);
    expect(actor.y).toBe(START.y);
    expect(actor.facing).toBe('left');
    expect(actor.moving).toBe(false);
  });

  /*
   * "moving" guida l'animazione: spingere contro un muro non deve far
   * camminare il personaggio sul posto.
   */
  it('segnala moving = false quando il muro blocca il movimento', () => {
    const grid = openField();
    // Contro il bordo sinistro della mappa, che e' sempre solido.
    const against: Actor = { x: 8.001, y: 160, facing: 'left', moving: false };
    const actor = stepActor(against, { ...NO_INPUT, left: true }, 0.1, grid, CONFIG);
    expect(actor.moving).toBe(false);
    expect(actor.facing).toBe('left');
  });

  it('aggiorna la direzione anche se il movimento e bloccato', () => {
    const grid = openField();
    const against: Actor = { x: 8.001, y: 160, facing: 'down', moving: false };
    expect(stepActor(against, { ...NO_INPUT, left: true }, 0.1, grid, CONFIG).facing).toBe('left');
  });
});
