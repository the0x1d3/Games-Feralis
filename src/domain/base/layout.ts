import { isSolidTile } from '../world/collision';
import type { CollisionGrid } from '../world/zone';
import type { BaseConfig, StructureDef } from './config';
import { canAfford, type BaseState, type PlacedStructure } from './state';

/**
 * Piazzamento sulla griglia.
 *
 * La validazione vive qui e non nella UI: il pannello di costruzione mostra il
 * motivo del rifiuto, ma è questa funzione a decidere. Una regola che vive
 * nell'interfaccia si aggira con un pulsante dimenticato.
 */

export type PlacementRefusal =
  | 'noTotem'
  | 'wrongZone'
  | 'outsideRadius'
  | 'blockedTerrain'
  | 'overlaps'
  | 'cannotAfford';

export interface PlacementCheck {
  readonly ok: boolean;
  readonly refusal?: PlacementRefusal;
}

const OK: PlacementCheck = { ok: true };

function refuse(refusal: PlacementRefusal): PlacementCheck {
  return { ok: false, refusal };
}

/** Tutte le caselle occupate da una struttura piazzata in (tx, ty). */
export function footprint(
  def: Pick<StructureDef, 'width' | 'height'>,
  tx: number,
  ty: number,
): Array<{ tx: number; ty: number }> {
  const tiles: Array<{ tx: number; ty: number }> = [];
  for (let dy = 0; dy < def.height; dy += 1) {
    for (let dx = 0; dx < def.width; dx += 1) tiles.push({ tx: tx + dx, ty: ty + dy });
  }
  return tiles;
}

/**
 * Dentro l'area rivendicata dal Totem.
 *
 * L'area è circolare (PDR §5.4) e si misura dal centro del Totem: **tutte** le
 * caselle della struttura devono starci dentro, non solo l'angolo. Metà
 * capanna fuori dalla Radura sarebbe una regola che il giocatore non riesce a
 * prevedere guardando lo schermo.
 */
export function withinRadius(
  base: BaseState,
  def: Pick<StructureDef, 'width' | 'height'>,
  tx: number,
  ty: number,
  config: BaseConfig,
): boolean {
  const totem = base.totem;
  if (totem === undefined) return false;

  const centerX = totem.tx + 1;
  const centerY = totem.ty + 1;
  const radius = config.totemRadiusTiles;

  return footprint(def, tx, ty).every((tile) => {
    const dx = tile.tx + 0.5 - centerX;
    const dy = tile.ty + 0.5 - centerY;
    return Math.hypot(dx, dy) <= radius;
  });
}

export function overlapsExisting(
  base: BaseState,
  structures: ReadonlyMap<string, StructureDef>,
  def: Pick<StructureDef, 'width' | 'height'>,
  tx: number,
  ty: number,
  ignoreId?: string,
): boolean {
  const wanted = new Set(footprint(def, tx, ty).map((tile) => `${tile.tx},${tile.ty}`));

  for (const placed of base.structures) {
    if (placed.id === ignoreId) continue;
    const placedDef = structures.get(placed.structureId);
    if (placedDef === undefined) continue;
    for (const tile of footprint(placedDef, placed.tx, placed.ty)) {
      if (wanted.has(`${tile.tx},${tile.ty}`)) return true;
    }
  }
  return false;
}

export interface PlacementContext {
  readonly base: BaseState;
  readonly structures: ReadonlyMap<string, StructureDef>;
  readonly config: BaseConfig;
  readonly grid: CollisionGrid;
  readonly zoneId: string;
  /** Falso quando si valuta il Totem stesso, che non costa nulla. */
  readonly checkCost?: boolean;
}

export function canPlace(
  def: StructureDef,
  tx: number,
  ty: number,
  context: PlacementContext,
): PlacementCheck {
  // Terreno: niente costruzioni sull'acqua, sui massi o dentro un albero.
  for (const tile of footprint(def, tx, ty)) {
    if (isSolidTile(context.grid, tile.tx, tile.ty)) return refuse('blockedTerrain');
  }

  if (def.kind !== 'totem') {
    if (context.base.totem === undefined) return refuse('noTotem');
    if (context.base.totem.zoneId !== context.zoneId) return refuse('wrongZone');
    if (!withinRadius(context.base, def, tx, ty, context.config)) return refuse('outsideRadius');
    if (overlapsExisting(context.base, context.structures, def, tx, ty)) return refuse('overlaps');
    if (context.checkCost !== false && !canAfford(context.base, def.cost)) {
      return refuse('cannotAfford');
    }
  }

  return OK;
}

let counter = 0;

/**
 * Identificatore di un esemplare piazzato.
 *
 * Non passa dal RNG seeded: non è un esito di gioco, è una chiave interna, e
 * legarla allo stream renderebbe la posizione del RNG dipendente da quante
 * capanne hai costruito.
 */
export function nextStructureId(base: BaseState): string {
  counter += 1;
  return `s${base.structures.length}_${counter}`;
}

export function place(
  base: BaseState,
  def: StructureDef,
  tx: number,
  ty: number,
): { base: BaseState; placed: PlacedStructure } {
  const placed: PlacedStructure = {
    id: nextStructureId(base),
    structureId: def.id,
    tx,
    ty,
    workUnits: 0,
  };

  const spent: Record<string, number> = {};
  for (const [id, amount] of Object.entries(def.cost)) spent[id] = -amount;

  const resources = { ...base.resources };
  for (const [id, delta] of Object.entries(spent)) {
    resources[id] = Math.max(0, (resources[id] ?? 0) + delta);
  }

  return {
    base: { ...base, resources, structures: [...base.structures, placed] },
    placed,
  };
}

/** Rimozione con rimborso del 50% (PDR §5.4). */
export function demolish(
  base: BaseState,
  structures: ReadonlyMap<string, StructureDef>,
  id: string,
): BaseState {
  const placed = base.structures.find((structure) => structure.id === id);
  if (placed === undefined) return base;

  const def = structures.get(placed.structureId);
  const resources = { ...base.resources };
  for (const [resource, amount] of Object.entries(def?.cost ?? {})) {
    resources[resource] = (resources[resource] ?? 0) + Math.floor(amount / 2);
  }

  return {
    ...base,
    resources,
    structures: base.structures.filter((structure) => structure.id !== id),
  };
}
