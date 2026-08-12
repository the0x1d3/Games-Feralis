import { describe, expect, it } from 'vitest';
import { applyLossFraction } from './inventory';

/**
 * Il prezzo della sconfitta (PDR §4.6): si perde una frazione dello zaino, mai
 * il deposito della Radura.
 */

describe('applyLossFraction', () => {
  it('toglie il dieci per cento arrotondando per difetto', () => {
    const result = applyLossFraction({ nodo_base: 25, nodo_migliorato: 4 }, 0.1);
    // 25 → 2 tolti; 4 → 0, perché il 10% di 4 non arriva a uno.
    expect(result.inventory).toEqual({ nodo_base: 23, nodo_migliorato: 4 });
    expect(result.lost).toEqual({ nodo_base: 2 });
  });

  /*
   * Una penalità che non si vede mai non è una penalità: con pile piccole si
   * toglie comunque un oggetto, e lo si prende dalla pila più alta.
   */
  it('toglie almeno un oggetto se lo zaino non è vuoto', () => {
    const result = applyLossFraction({ nodo_base: 3, nodo_migliorato: 1 }, 0.1);
    expect(result.lost).toEqual({ nodo_base: 1 });
    expect(result.inventory).toEqual({ nodo_base: 2, nodo_migliorato: 1 });
  });

  it('uno zaino vuoto resta vuoto, senza inventare pile', () => {
    expect(applyLossFraction({}, 0.1)).toEqual({ inventory: {}, lost: {} });
    expect(applyLossFraction({ nodo_base: 0 }, 0.1).lost).toEqual({});
  });

  it('una frazione nulla non tocca nulla', () => {
    const inventory = { nodo_base: 25 };
    expect(applyLossFraction(inventory, 0).inventory).toBe(inventory);
  });

  it('una frazione fuori scala viene riportata dentro', () => {
    expect(applyLossFraction({ nodo_base: 10 }, 5).inventory).toEqual({ nodo_base: 0 });
    expect(applyLossFraction({ nodo_base: 10 }, -1).inventory).toEqual({ nodo_base: 10 });
  });
});
