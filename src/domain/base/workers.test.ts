import { describe, expect, it } from 'vitest';
import structureData from '@data/structures.json';
import dewSprout from '@data/species/dew_sprout.json';
import emberPup from '@data/species/ember_pup.json';
import type { CreatureInstance } from '../creature/instance';
import { parseSpecies, type Species } from '../creature/species';
import { parseStructures } from './config';
import { emptyBase, structureAt, type BaseState } from './state';
import { assign, canAssign, pruneWorkers, unassign, workLevelOf } from './workers';

/**
 * L'assegnazione dei lavoratori.
 *
 * È il punto in cui il secondo pilastro del gioco diventa una regola: ogni
 * Ferale ha una scheda di lavoro oltre a quella di combattimento (PDR §1.3), e
 * una struttura accetta solo chi ha la mansione giusta al livello giusto.
 */

const structures = parseStructures(structureData);
const flora = parseSpecies(dewSprout, 'dew_sprout');
const fuoco = parseSpecies(emberPup, 'ember_pup');

function creature(uid: string, speciesId: string, hp = 20): CreatureInstance {
  return {
    uid,
    speciesId,
    level: 5,
    xp: 0,
    ivs: { hp: 0, att: 0, dif: 0, vel: 0, ele: 0, res: 0 },
    traits: [],
    hp,
    moves: [],
    isAlpha: false,
    morale: 100,
    caughtAt: 0,
  };
}

function withStructures(...ids: readonly string[]): BaseState {
  return {
    ...emptyBase(),
    totem: { zoneId: 'costa', tx: 10, ty: 10 },
    structures: ids.map((structureId, index) => ({
      id: `p${index}`,
      structureId,
      tx: 12 + index * 3,
      ty: 12,
      workUnits: 0,
    })),
  };
}

/** La mansione con il livello più alto fra quelle che una specie conosce. */
function bestWork(species: Species): string {
  const entries = Object.entries(species.work);
  const best = entries.reduce((top, entry) => (entry[1] > top[1] ? entry : top), entries[0] ?? ['', 0]);
  return best[0];
}

describe('livello nella mansione', () => {
  it('vale 0 per una mansione che la specie non conosce', () => {
    expect(workLevelOf(flora, 'flame')).toBe(0);
    expect(workLevelOf(flora, undefined)).toBe(0);
  });

  it('legge il livello dichiarato dalla specie', () => {
    const work = bestWork(flora);
    expect(workLevelOf(flora, work)).toBeGreaterThan(0);
  });
});

describe('canAssign', () => {
  it('accetta chi sa fare il mestiere', () => {
    const base = withStructures('taglialegna');
    expect(canAssign(base, 'p0', creature('a', 'dew_sprout'), flora, structures).ok).toBe(true);
  });

  it('rifiuta chi non sa fare quel mestiere', () => {
    // dew_sprout non conosce la Fiamma: alla fornace non serve a nulla.
    const base = withStructures('fornace');
    const check = canAssign(base, 'p0', creature('a', 'dew_sprout'), flora, structures);
    expect(check.refusal).toBe('wrongWork');
  });

  it('rifiuta chi la sa fare ma non abbastanza bene', () => {
    // ember_pup ha Raccolta 1, e il raccoglifibra ne pretende 2.
    const base = withStructures('raccoglifibra');
    const check = canAssign(base, 'p0', creature('b', 'ember_pup'), fuoco, structures);
    expect(check.refusal).toBe('lowLevel');
  });

  /* Un Ferale a terra non lavora: sarebbe una via per ignorare le sconfitte. */
  it('rifiuta un Ferale a terra', () => {
    const base = withStructures('taglialegna');
    const check = canAssign(base, 'p0', creature('a', 'dew_sprout', 0), flora, structures);
    expect(check.refusal).toBe('fainted');
  });

  it('rifiuta una struttura che non produce', () => {
    const base = withStructures('mangiatoia');
    const check = canAssign(base, 'p0', creature('a', 'dew_sprout'), flora, structures);
    expect(check.refusal).toBe('notProducer');
  });

  it('rifiuta una struttura inesistente', () => {
    const base = withStructures('taglialegna');
    const check = canAssign(base, 'ignota', creature('a', 'dew_sprout'), flora, structures);
    expect(check.refusal).toBe('noStructure');
  });

  it('rifiuta chi è già assegnato altrove', () => {
    const base = assign(withStructures('taglialegna', 'raccoglifibra'), 'p0', 'a');
    const check = canAssign(base, 'p1', creature('a', 'dew_sprout'), flora, structures);
    expect(check.refusal).toBe('alreadyAssigned');
  });
});

describe('assegnare e richiamare', () => {
  /*
   * Il lavoro accumulato si azzera al cambio. Lasciarlo significherebbe che
   * togliere un lavoratore lento e metterne uno veloce a un soffio dal ciclo
   * regala una produzione che nessuno dei due ha fatto.
   */
  it('azzera il lavoro accumulato', () => {
    const start = withStructures('taglialegna');
    const loaded: BaseState = {
      ...start,
      structures: start.structures.map((s) => ({ ...s, workUnits: 999_999 })),
    };

    expect(structureAt(assign(loaded, 'p0', 'a'), 'p0')?.workUnits).toBe(0);
    expect(structureAt(unassign(assign(loaded, 'p0', 'a'), 'p0'), 'p0')?.workUnits).toBe(0);
  });

  it('un Ferale sta in un posto solo', () => {
    let base = withStructures('taglialegna', 'raccoglifibra');
    base = assign(base, 'p0', 'a');
    base = assign(base, 'p1', 'a');

    expect(structureAt(base, 'p0')?.workerUid).toBeUndefined();
    expect(structureAt(base, 'p1')?.workerUid).toBe('a');
  });

  it('richiamare libera il posto', () => {
    const base = unassign(assign(withStructures('taglialegna'), 'p0', 'a'), 'p0');
    expect(structureAt(base, 'p0')?.workerUid).toBeUndefined();
  });

  /* Un Ferale rilasciato o scambiato non deve restare al lavoro come fantasma. */
  it('toglie i lavoratori che non esistono più', () => {
    const base = assign(withStructures('taglialegna'), 'p0', 'a');
    const pruned = pruneWorkers(base, new Set(['b']));
    expect(structureAt(pruned, 'p0')?.workerUid).toBeUndefined();
  });
});
