import { type Body, moveWithCollision } from './collision';
import type { CollisionGrid, Facing } from './zone';

/**
 * Movimento a 8 direzioni, deterministico e a passo fisso.
 *
 * Non c'e' accelerazione ne' inerzia: in un gioco dove il combattimento e'
 * a turni, il movimento deve essere preciso e prevedibile, non "pesante".
 */

export interface MoveInput {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

export const NO_INPUT: MoveInput = { up: false, down: false, left: false, right: false };

export interface Actor {
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly moving: boolean;
}

export interface MovementConfig {
  readonly speedTilesPerSecond: number;
  readonly body: Body;
}

export interface Intent {
  readonly x: number;
  readonly y: number;
}

const DIAGONAL = Math.SQRT1_2;

/**
 * Direzione dall'input, gia' normalizzata.
 *
 * La normalizzazione sulle diagonali non e' un dettaglio: senza, muoversi in
 * diagonale sarebbe il 41% piu' veloce che in linea retta, e i giocatori se ne
 * accorgono anche quando non sanno dire perche'.
 */
export function intentFrom(input: MoveInput): Intent {
  const x = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const y = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (x !== 0 && y !== 0) return { x: x * DIAGONAL, y: y * DIAGONAL };
  return { x, y };
}

/**
 * Direzione dello sguardo. A parita' di componenti (diagonale perfetta) vince
 * l'orizzontale: gli sprite di profilo si leggono meglio di quelli di spalle.
 */
export function facingFrom(intent: Intent, previous: Facing): Facing {
  if (intent.x === 0 && intent.y === 0) return previous;
  if (Math.abs(intent.x) >= Math.abs(intent.y)) return intent.x > 0 ? 'right' : 'left';
  return intent.y > 0 ? 'down' : 'up';
}

/** Un passo di simulazione. Puro: stesso ingresso, stessa uscita, sempre. */
export function stepActor(
  actor: Actor,
  input: MoveInput,
  dtSeconds: number,
  grid: CollisionGrid,
  config: MovementConfig,
): Actor {
  const intent = intentFrom(input);
  const facing = facingFrom(intent, actor.facing);

  if (intent.x === 0 && intent.y === 0) {
    return { x: actor.x, y: actor.y, facing, moving: false };
  }

  const distance = config.speedTilesPerSecond * grid.tileSize * dtSeconds;
  const next = moveWithCollision(
    grid,
    { x: actor.x, y: actor.y },
    intent.x * distance,
    intent.y * distance,
    config.body,
  );

  // "moving" guida l'animazione: se si spinge contro un muro il personaggio
  // non deve continuare a camminare sul posto.
  const moved = Math.abs(next.x - actor.x) > 1e-6 || Math.abs(next.y - actor.y) > 1e-6;
  return { x: next.x, y: next.y, facing, moving: moved };
}
