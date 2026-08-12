import { describe, expect, it } from 'vitest';
import baseData from '@data/base.json';
import structureData from '@data/structures.json';
import type { CollisionGrid } from '../world/zone';
import { parseBaseConfig, parseStructures, totemStructure } from './config';
import { canPlace, demolish, footprint, place, withinRadius } from './layout';
import { emptyBase, resourceOf, type BaseState } from './state';

/**
 * Le regole del piazzamento.
 *
 * Vivono nel dominio e non nel pannello perché una regola che sta
 * nell'interfaccia si aggira con un pulsante dimenticato: qui si dimostra che
 * rispondono anche quando nessuno guarda.
 */

const config = parseBaseConfig(baseData);
const structures = parseStructures(structureData);

function def(id: string) {
  const found = structures.get(id);
  if (found === undefined) throw new Error(`struttura assente: ${id}`);
  return found;
}

/** Una radura tutta calpestabile, con uno scoglio solido in (5,5). */
const grid: CollisionGrid = {
  width: 40,
  height: 40,
  tileSize: 32,
  solid: Uint8Array.from({ length: 40 * 40 }, (_, index) => (index === 5 * 40 + 5 ? 1 : 0)),
};

function planted(resources: Record<string, number> = { legna: 100, pietra: 100 }): BaseState {
  return { ...emptyBase(), totem: { zoneId: 'costa', tx: 10, ty: 10 }, resources };
}

function context(base: BaseState) {
  return { base, structures, config, grid, zoneId: 'costa' } as const;
}

describe('impronta', () => {
  it('copre tutte le caselle dichiarate, non solo l angolo', () => {
    expect(footprint({ width: 3, height: 2 }, 4, 7)).toHaveLength(6);
    expect(footprint({ width: 3, height: 2 }, 4, 7)).toContainEqual({ tx: 6, ty: 8 });
  });
});

describe('area rivendicata dal Totem', () => {
  it('pretende che TUTTA l impronta stia dentro il raggio', () => {
    const base = planted();
    const edge = 10 + config.totemRadiusTiles;
    // Con l'angolo dentro ma il resto fuori il piazzamento deve fallire: mezza
    // capanna oltre il confine è una regola che nessuno riesce a prevedere.
    expect(withinRadius(base, { width: 1, height: 1 }, edge - 1, 11, config)).toBe(true);
    expect(withinRadius(base, { width: 3, height: 2 }, edge - 1, 11, config)).toBe(false);
  });

  it('senza Totem nulla è dentro il raggio', () => {
    expect(withinRadius(emptyBase(), { width: 1, height: 1 }, 10, 10, config)).toBe(false);
  });
});

describe('canPlace', () => {
  it('accetta una casella libera dentro la Radura', () => {
    expect(canPlace(def('cava'), 12, 12, context(planted())).ok).toBe(true);
  });

  it('rifiuta il terreno solido, e dice perché', () => {
    const check = canPlace(def('cava'), 4, 4, context(planted()));
    expect(check).toEqual({ ok: false, refusal: 'blockedTerrain' });
  });

  it('rifiuta fuori dal raggio', () => {
    expect(canPlace(def('cava'), 30, 30, context(planted())).refusal).toBe('outsideRadius');
  });

  it('rifiuta senza Totem', () => {
    const base = { ...emptyBase(), resources: { legna: 100 } };
    expect(canPlace(def('cava'), 12, 12, context(base)).refusal).toBe('noTotem');
  });

  it('rifiuta in una zona diversa da quella della Radura', () => {
    const check = canPlace(def('cava'), 12, 12, {
      ...context(planted()),
      zoneId: 'bosco',
    });
    expect(check.refusal).toBe('wrongZone');
  });

  it('rifiuta la sovrapposizione', () => {
    const base = place(planted(), def('cava'), 12, 12).base;
    expect(canPlace(def('taglialegna'), 13, 13, context(base)).refusal).toBe('overlaps');
  });

  it('rifiuta se le risorse non bastano', () => {
    const base = planted({ legna: 1 });
    expect(canPlace(def('cava'), 12, 12, context(base)).refusal).toBe('cannotAfford');
  });

  /* Il Totem non costa nulla e non ha bisogno di sé stesso: solo il terreno. */
  it('il Totem risponde al terreno ma non al raggio', () => {
    const totem = totemStructure(structures);
    expect(totem).toBeDefined();
    if (totem === undefined) return;
    expect(canPlace(totem, 30, 30, context(emptyBase())).ok).toBe(true);
    expect(canPlace(totem, 5, 5, context(emptyBase())).refusal).toBe('blockedTerrain');
  });
});

describe('costruire e smontare', () => {
  it('costruire spende, smontare restituisce metà', () => {
    const start = planted({ legna: 100 });
    const built = place(start, def('cava'), 12, 12);

    expect(resourceOf(built.base, 'legna')).toBe(100 - 15);

    const back = demolish(built.base, structures, built.placed.id);
    expect(resourceOf(back, 'legna')).toBe(100 - 15 + 7);
    expect(back.structures).toHaveLength(0);
  });

  it('smontare qualcosa che non c è non cambia nulla', () => {
    const base = planted();
    expect(demolish(base, structures, 'inesistente')).toBe(base);
  });

  it('ogni struttura piazzata ha un id diverso', () => {
    let base = planted();
    const ids = new Set<string>();
    for (const [tx, ty] of [
      [12, 12],
      [15, 12],
      [12, 15],
    ] as const) {
      const result = place(base, def('cava'), tx, ty);
      base = result.base;
      ids.add(result.placed.id);
    }
    expect(ids.size).toBe(3);
  });
});
