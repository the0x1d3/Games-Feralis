import { describe, expect, it } from 'vitest';
import creatureData from '@data/creatures.json';
import itemData from '@data/items.json';
import dewSprout from '@data/species/dew_sprout.json';
import { createCreature, maxHp, type CreatureInstance } from '../creature/instance';
import { parseSpecies } from '../creature/species';
import { parseCreatureConfig } from '../creature/stats';
import { createRng } from '../rng';
import { applyItem, parseItems, type ItemDef } from './items';

const config = parseCreatureConfig(creatureData);
const species = parseSpecies(dewSprout, 'dew_sprout');
const items = parseItems(itemData);

function item(id: string): ItemDef {
  const found = items.get(id);
  if (found === undefined) throw new Error(`oggetto assente da items.json: ${id}`);
  return found;
}

const base = createCreature(
  { species, level: 8, isAlpha: false, caughtAt: 0 },
  config,
  createRng(4242),
);
const FULL = maxHp(base, species, config);

function withHp(hp: number, extra: Partial<CreatureInstance> = {}): CreatureInstance {
  return { ...base, hp, ...extra };
}

describe('parseItems', () => {
  it('legge tutti gli oggetti dichiarati', () => {
    expect(items.size).toBeGreaterThanOrEqual(4);
    expect(item('bacca_verde').kind).toBe('heal');
    expect(item('essenza_viva').usableInBattle).toBe(false);
  });
});

describe('cura', () => {
  it('restituisce punti vita senza superare il massimo', () => {
    const use = applyItem(item('bacca_ambra'), withHp(10), FULL);
    expect(use.applied).toBe(true);
    expect(use.creature.hp).toBeLessThanOrEqual(FULL);
    expect(use.creature.hp).toBeGreaterThan(10);
  });

  /*
   * Un oggetto che non ha effetto non viene consumato. Il riduttore si fida di
   * `applied`: la regola vive qui, in un posto solo.
   */
  it('rifiuta su chi è già al massimo', () => {
    const use = applyItem(item('bacca_verde'), withHp(FULL), FULL);
    expect(use.applied).toBe(false);
    expect(use.refusal).toBe('alreadyFull');
  });

  it('rifiuta su chi è a terra: per quello serve una rianimazione', () => {
    const use = applyItem(item('bacca_verde'), withHp(0), FULL);
    expect(use.applied).toBe(false);
    expect(use.refusal).toBe('fainted');
  });
});

describe('guarigione dagli stati', () => {
  it('toglie lo stato alterato', () => {
    const use = applyItem(item('resina_calma'), withHp(100, { status: 'burned' }), FULL);
    expect(use.applied).toBe(true);
    expect(use.creature.status).toBeUndefined();
  });

  it('rifiuta su chi non ha stati', () => {
    const use = applyItem(item('resina_calma'), withHp(100), FULL);
    expect(use.applied).toBe(false);
    expect(use.refusal).toBe('noStatus');
  });
});

describe('rianimazione', () => {
  it('rimette in piedi con una frazione degli HP massimi', () => {
    const use = applyItem(item('essenza_viva'), withHp(0, { status: 'burned' }), FULL);
    expect(use.applied).toBe(true);
    expect(use.creature.hp).toBeGreaterThan(0);
    expect(use.creature.hp).toBeLessThan(FULL);
    expect(use.creature.status).toBeUndefined();
  });

  it('rifiuta su chi è ancora in piedi', () => {
    const use = applyItem(item('essenza_viva'), withHp(50), FULL);
    expect(use.applied).toBe(false);
    expect(use.refusal).toBe('notFainted');
  });
});
