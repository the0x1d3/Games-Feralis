import type { Actor } from './movement';
import type { ExitObject, Facing, SignObject, Zone } from './zone';

/**
 * Interazione con il mondo: cosa c'e' davanti al giocatore, e dove porta la
 * casella su cui si trova.
 */

const STEP: Readonly<Record<Facing, { readonly x: number; readonly y: number }>> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface TileCoord {
  readonly tx: number;
  readonly ty: number;
}

/** La casella che il giocatore sta guardando: e' li' che si cerca un cartello. */
export function tileInFront(actor: Actor, tileSize: number): TileCoord {
  const step = STEP[actor.facing];
  return {
    tx: Math.floor(actor.x / tileSize) + step.x,
    ty: Math.floor(actor.y / tileSize) + step.y,
  };
}

export function signAt(zone: Zone, tile: TileCoord): SignObject | undefined {
  for (const object of zone.objects) {
    if (object.kind !== 'sign') continue;
    const tx = Math.floor(object.x / zone.tileSize);
    const ty = Math.floor(object.y / zone.tileSize);
    if (tx === tile.tx && ty === tile.ty) return object;
  }
  return undefined;
}

/** Il cartello davanti al giocatore, se c'e'. */
export function facingSign(zone: Zone, actor: Actor): SignObject | undefined {
  return signAt(zone, tileInFront(actor, zone.tileSize));
}

/**
 * L'uscita sotto i piedi del giocatore.
 *
 * Si controlla il punto centrale e non il rettangolo del corpo: entrare in una
 * zona nuova deve richiedere di mettercisi davvero sopra, non di sfiorarla con
 * uno spigolo mentre si cammina lungo il bordo della mappa.
 */
export function exitUnder(zone: Zone, actor: Actor): ExitObject | undefined {
  for (const object of zone.objects) {
    if (object.kind !== 'exit') continue;
    if (
      actor.x >= object.x &&
      actor.x < object.x + object.width &&
      actor.y >= object.y &&
      actor.y < object.y + object.height
    ) {
      return object;
    }
  }
  return undefined;
}
