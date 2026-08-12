import { describe, expect, it } from 'vitest';
import battleData from '@data/battle.json';
import moveData from '@data/moves.json';
import { parseMoves, type ElementType, type Move, type StatBlock } from '../creature/species';
import { createRng } from '../rng';
import { parseBattleConfig } from './config';
import { computeDamage, expectedDamage, type Combatant } from './damage';
import { effectivenessOf, typeMultiplier } from './typechart';

const config = parseBattleConfig(battleData);
const moves = parseMoves(moveData);

function move(id: string): Move {
  const found = moves.get(id);
  if (found === undefined) throw new Error(`Mossa assente da moves.json: ${id}`);
  return found;
}

const STATS: StatBlock = { hp: 900, att: 60, dif: 60, vel: 60, ele: 60, res: 60 };

function combatant(types: ElementType[], overrides: Partial<Combatant> = {}): Combatant {
  return { level: 10, stats: STATS, types, ...overrides };
}

/** Mossa senza varianza né mancati: isola il fattore che si sta misurando. */
const SURE: Move = { ...move('colpo'), accuracy: 1 };

describe('triangoli dei tipi', () => {
  it('Flora → Acqua → Fuoco → Flora', () => {
    expect(typeMultiplier('flora', ['acqua'], config)).toBe(config.types.advantage);
    expect(typeMultiplier('acqua', ['fuoco'], config)).toBe(config.types.advantage);
    expect(typeMultiplier('fuoco', ['flora'], config)).toBe(config.types.advantage);
  });

  it('Fulmine → Vento → Terra → Fulmine', () => {
    expect(typeMultiplier('fulmine', ['vento'], config)).toBe(config.types.advantage);
    expect(typeMultiplier('vento', ['terra'], config)).toBe(config.types.advantage);
    expect(typeMultiplier('terra', ['fulmine'], config)).toBe(config.types.advantage);
  });

  it('il verso opposto è svantaggio', () => {
    expect(typeMultiplier('acqua', ['flora'], config)).toBe(config.types.disadvantage);
    expect(typeMultiplier('vento', ['fulmine'], config)).toBe(config.types.disadvantage);
  });

  it('i due triangoli non si toccano', () => {
    for (const a of ['flora', 'acqua', 'fuoco'] as const) {
      for (const b of ['fulmine', 'vento', 'terra'] as const) {
        expect(typeMultiplier(a, [b], config)).toBe(1);
        expect(typeMultiplier(b, [a], config)).toBe(1);
      }
    }
  });

  it('Neutro non ha né forze né debolezze', () => {
    for (const type of ['flora', 'acqua', 'fuoco', 'fulmine', 'vento', 'terra'] as const) {
      expect(typeMultiplier('neutro', [type], config)).toBe(1);
      expect(typeMultiplier(type, ['neutro'], config)).toBe(1);
    }
  });

  it('contro un doppio tipo i moltiplicatori si moltiplicano', () => {
    expect(typeMultiplier('acqua', ['fuoco', 'fuoco'], config)).toBeCloseTo(1.5 * 1.5, 6);
    expect(typeMultiplier('acqua', ['fuoco', 'flora'], config)).toBeCloseTo(1.5 * 0.66, 6);
  });

  /* Nessuna immunità: nessun matchup è mai senza uscita. */
  it('nessuna combinazione azzera il danno', () => {
    for (const attack of [
      'neutro',
      'flora',
      'acqua',
      'fuoco',
      'fulmine',
      'vento',
      'terra',
    ] as const) {
      for (const a of ['flora', 'acqua', 'fuoco'] as const) {
        for (const b of ['fulmine', 'vento', 'terra'] as const) {
          expect(typeMultiplier(attack, [a, b], config)).toBeGreaterThan(0.4);
        }
      }
    }
  });

  it('effectivenessOf accompagna il colore con una parola', () => {
    expect(effectivenessOf(1.5)).toBe('advantage');
    expect(effectivenessOf(1)).toBe('neutral');
    expect(effectivenessOf(0.66)).toBe('disadvantage');
  });
});

describe('computeDamage', () => {
  it('è riproducibile a parità di seme', () => {
    const a = createRng(99);
    const b = createRng(99);
    const attacker = combatant(['neutro']);
    const defender = combatant(['neutro']);
    expect(computeDamage(attacker, defender, SURE, { hasInitiative: false }, config, a)).toEqual(
      computeDamage(attacker, defender, SURE, { hasInitiative: false }, config, b),
    );
  });

  it('non scende mai sotto 1', () => {
    const rng = createRng(3);
    const weak = combatant(['neutro'], { stats: { ...STATS, att: 1 } });
    const wall = combatant(['neutro'], { stats: { ...STATS, dif: 10_000 } });
    for (let i = 0; i < 200; i += 1) {
      const result = computeDamage(weak, wall, SURE, { hasInitiative: false }, config, rng);
      if (!result.missed) expect(result.damage).toBeGreaterThanOrEqual(1);
    }
  });

  /*
   * `ratio = att/(att+dif)` invece di `att/dif` è la scelta che evita
   * l'esplosione del danno: anche con attacco dieci volte la difesa il
   * rapporto resta sotto 1, quindi niente one-shot casuali.
   */
  it('un attacco enorme non produce danno illimitato', () => {
    const rng = createRng(5);
    const titan = combatant(['neutro'], { stats: { ...STATS, att: 100_000 } });
    const normal = combatant(['neutro']);
    const result = computeDamage(titan, normal, SURE, { hasInitiative: false }, config, rng);
    expect(result.damage).toBeLessThan(SURE.power * 3);
  });

  it('più attacco fa più danno, più difesa ne fa meno', () => {
    const strong = expectedDamage(
      combatant(['neutro'], { stats: { ...STATS, att: 90 } }),
      combatant(['neutro']),
      SURE,
      config,
    );
    const weak = expectedDamage(
      combatant(['neutro'], { stats: { ...STATS, att: 30 } }),
      combatant(['neutro']),
      SURE,
      config,
    );
    const armoured = expectedDamage(
      combatant(['neutro']),
      combatant(['neutro'], { stats: { ...STATS, dif: 200 } }),
      SURE,
      config,
    );
    expect(strong).toBeGreaterThan(weak);
    expect(armoured).toBeLessThan(
      expectedDamage(combatant(['neutro']), combatant(['neutro']), SURE, config),
    );
  });

  it('il vantaggio di tipo si vede nel danno', () => {
    const water = { ...move('spruzzo'), accuracy: 1 };
    const vsFire = expectedDamage(combatant(['acqua']), combatant(['fuoco']), water, config);
    const vsNeutral = expectedDamage(combatant(['acqua']), combatant(['neutro']), water, config);
    expect(vsFire).toBeGreaterThan(vsNeutral);
  });

  it('la sorpresa vale solo quando dichiarata', () => {
    const attacker = combatant(['neutro']);
    const defender = combatant(['neutro']);
    const plain = computeDamage(
      attacker,
      defender,
      SURE,
      { hasInitiative: false },
      config,
      createRng(11),
    );
    const back = computeDamage(
      attacker,
      defender,
      SURE,
      { hasInitiative: true },
      config,
      createRng(11),
    );
    expect(back.damage).toBeGreaterThan(plain.damage);
  });

  it('una mossa imprecisa manca qualche volta', () => {
    const rng = createRng(21);
    const sloppy = { ...move('scossone'), accuracy: 0.5 };
    let missed = 0;
    for (let i = 0; i < 2000; i += 1) {
      if (
        computeDamage(
          combatant(['terra']),
          combatant(['neutro']),
          sloppy,
          { hasInitiative: false },
          config,
          rng,
        ).missed
      ) {
        missed += 1;
      }
    }
    expect(missed / 2000).toBeCloseTo(0.5, 1);
  });
});

describe('stati che toccano il danno', () => {
  it('Bruciato abbassa l attacco fisico ma non quello elementale', () => {
    const burned = { id: 'burned', turnsLeft: 3 } as const;
    const physical = { ...move('colpo'), accuracy: 1 };
    const elemental = { ...move('favilla'), accuracy: 1 };

    const healthy = combatant(['neutro']);
    const scorched = combatant(['neutro'], { status: burned });

    expect(expectedDamage(scorched, healthy, physical, config)).toBeLessThan(
      expectedDamage(healthy, healthy, physical, config),
    );
    expect(expectedDamage(scorched, healthy, elemental, config)).toBeCloseTo(
      expectedDamage(healthy, healthy, elemental, config),
      6,
    );
  });

  /*
   * Errata E3: Bagnato abbassa la resistenza al FULMINE, non al fuoco. Un
   * bersaglio bagnato più vulnerabile al fuoco sarebbe controintuitivo.
   */
  it('Bagnato rende più vulnerabili al Fulmine, non al Fuoco', () => {
    const wet = combatant(['neutro'], { status: { id: 'wet', turnsLeft: 3 } });
    const dry = combatant(['neutro']);
    const jolt = { ...move('scossa'), accuracy: 1 };
    const flare = { ...move('vampata'), accuracy: 1 };

    expect(expectedDamage(dry, wet, jolt, config)).toBeGreaterThan(
      expectedDamage(dry, dry, jolt, config),
    );
    expect(expectedDamage(dry, wet, flare, config)).toBeCloseTo(
      expectedDamage(dry, dry, flare, config),
      6,
    );
  });
});
