/** Tipi del mondo esplorabile. Nessuna dipendenza: e' il vocabolario condiviso. */

export const FACINGS = ['down', 'left', 'right', 'up'] as const;

export type Facing = (typeof FACINGS)[number];

/** Indice del fotogramma nello sprite del giocatore, nell'ordine di FACINGS. */
export function facingFrame(facing: Facing): number {
  return FACINGS.indexOf(facing);
}

export interface TileRule {
  readonly id: number;
  readonly key: string;
  readonly solid: boolean;
  /** Mansione che in futuro rimuovera' l'ostacolo (PDR §5.1). Non usata in Fase 1. */
  readonly clearedBy?: string;
  /** Vero sull'erba alta: camminarci sopra puo' far comparire un Ferale selvatico. */
  readonly encounter: boolean;
}

export interface TileRules {
  readonly tileSize: number;
  readonly byId: ReadonlyMap<number, TileRule>;
}

export interface SpawnObject {
  readonly kind: 'spawn';
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

export interface ExitObject {
  readonly kind: 'exit';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly toZone: string;
  readonly toSpawn: string;
}

export interface SignObject {
  readonly kind: 'sign';
  readonly x: number;
  readonly y: number;
  readonly textKey: string;
}

export type ZoneObject = SpawnObject | ExitObject | SignObject;

export interface ZoneLayers {
  /** Indici di tile 0-based; -1 significa casella vuota (i gid di Tiled sono 1-based). */
  readonly ground: readonly number[];
  readonly decor: readonly number[];
  readonly over: readonly number[];
}

/**
 * Griglia di collisione: una casella per tile, 1 = solido.
 * Fuori dai bordi si considera SEMPRE solido, cosi' nessuna zona ha bisogno di
 * un muro perimetrale esplicito per non far cadere il giocatore nel vuoto.
 */
export interface CollisionGrid {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly solid: Uint8Array;
}

export interface Zone {
  readonly id: string;
  readonly nameKey: string;
  /** In tile. */
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly layers: ZoneLayers;
  readonly objects: readonly ZoneObject[];
  readonly collision: CollisionGrid;
}

/** Il tile calpestato in una casella: il decor vince sul fondo se c'è. */
export function groundTileAt(zone: Zone, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= zone.width || ty >= zone.height) return -1;
  return zone.layers.ground[ty * zone.width + tx] ?? -1;
}

export function triggersEncounter(zone: Zone, rules: TileRules, tx: number, ty: number): boolean {
  const tile = groundTileAt(zone, tx, ty);
  return tile >= 0 && (rules.byId.get(tile)?.encounter ?? false);
}

export function pixelWidth(zone: Zone): number {
  return zone.width * zone.tileSize;
}

export function pixelHeight(zone: Zone): number {
  return zone.height * zone.tileSize;
}

export function findSpawn(zone: Zone, name: string): SpawnObject {
  for (const object of zone.objects) {
    if (object.kind === 'spawn' && object.name === name) return object;
  }
  throw new Error(`La zona "${zone.id}" non ha un punto di comparsa chiamato "${name}"`);
}

export function buildCollisionGrid(
  width: number,
  height: number,
  layers: ZoneLayers,
  rules: TileRules,
): CollisionGrid {
  const solid = new Uint8Array(width * height);
  const isSolid = (tileId: number): boolean =>
    tileId >= 0 && (rules.byId.get(tileId)?.solid ?? false);

  for (let i = 0; i < solid.length; i += 1) {
    // Il layer "over" (chiome) non blocca: ci si cammina sotto, ed e' il punto.
    const ground = layers.ground[i] ?? -1;
    const decor = layers.decor[i] ?? -1;
    solid[i] = isSolid(ground) || isSolid(decor) ? 1 : 0;
  }

  return { width, height, tileSize: rules.tileSize, solid };
}
