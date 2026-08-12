import { describe, expect, it } from 'vitest';
import creatureData from '@data/creatures.json';
import dewSprout from '@data/species/dew_sprout.json';
import stoneGrub from '@data/species/stone_grub.json';
import { createRng } from '../rng';
import { createCreature, generateUid, healParty, maxHp, rollIvs, rollTraits } from './instance';
import { knownMoves, parseSpecies, STAT_KEYS, type StatBlock } from './species';
import { computeStats, parseCreatureConfig, xpToNextLevel } from './stats';

const config = parseCreatureConfig(creatureData);
const sprout = parseSpecies(dewSprout, 'dew_sprout');
const grub = parseSpecies(stoneGrub, 'stone_grub');

const FLAT_IVS: StatBlock = { hp: 0, att: 0, dif: 0, vel: 0, ele: 0, res: 0 };
const MAX_IVS: StatBlock = { hp: 31, att: 31, dif: 31, vel: 31, ele: 31, res: 31 };

function statsOf(level: number, ivs = FLAT_IVS, traits: string[] = [], isAlpha = false): StatBlock {
  return computeStats({ species: sprout, level, ivs, traits, isAlpha }, config);
}

describe('computeStats', () => {
  it('cresce con il livello', () => {
    const low = statsOf(5);
    const high = statsOf(30);
    for (const key of STAT_KEYS) expect(high[key]).toBeGreaterThan(low[key]);
  });

  it('gli IV fanno differenza, ma non stravolgono', () => {
    const plain = statsOf(20);
    const gifted = statsOf(20, MAX_IVS);

    expect(gifted.att).toBeGreaterThan(plain.att);
    // Massimo circa +15%: la varianza individuale non deve sostituire il livello.
    expect(gifted.att / plain.att).toBeLessThan(1.2);
  });

  it('nessuna statistica scende sotto 1', () => {
    const tiny = computeStats(
      { species: sprout, level: 1, ivs: FLAT_IVS, traits: ['fragile'], isAlpha: false },
      config,
    );
    for (const key of STAT_KEYS) expect(tiny[key]).toBeGreaterThanOrEqual(1);
  });

  /*
   * I tratti sono modificatori DERIVATI, non valori salvati (errata E7):
   * ricalcolarli ogni volta è ciò che permette di ribilanciare un tratto senza
   * una migrazione dei salvataggi.
   */
  it('i tratti modificano le statistiche nella direzione dichiarata', () => {
    const plain = statsOf(20);
    const fragile = statsOf(20, FLAT_IVS, ['fragile']);
    const sturdy = statsOf(20, FLAT_IVS, ['robusto']);

    expect(fragile.hp).toBeLessThan(plain.hp);
    expect(fragile.vel).toBeGreaterThan(plain.vel);
    expect(sturdy.hp).toBeGreaterThan(plain.hp);
    expect(sturdy.vel).toBeLessThan(plain.vel);
  });

  it('due tratti si sommano invece di comporsi', () => {
    const plain = statsOf(20);
    const both = statsOf(20, FLAT_IVS, ['furioso', 'focoso']);
    expect(both.att).toBeGreaterThan(plain.att);
    expect(both.ele).toBeGreaterThan(plain.ele);
    expect(both.dif).toBeLessThan(plain.dif);
  });

  it('un tratto sconosciuto viene ignorato invece di far esplodere il calcolo', () => {
    expect(statsOf(20, FLAT_IVS, ['inventato'])).toEqual(statsOf(20));
  });

  it('un Alfa è nettamente più forte', () => {
    const normal = statsOf(15);
    const alpha = statsOf(15, FLAT_IVS, [], true);
    expect(alpha.att / normal.att).toBeCloseTo(config.alpha.statMultiplier, 1);
  });

  it('rispetta il profilo della specie', () => {
    const sprouty = computeStats(
      { species: sprout, level: 20, ivs: FLAT_IVS, traits: [], isAlpha: false },
      config,
    );
    const grubby = computeStats(
      { species: grub, level: 20, ivs: FLAT_IVS, traits: [], isAlpha: false },
      config,
    );
    expect(grubby.dif).toBeGreaterThan(sprouty.dif); // il grub è la roccia
    expect(sprouty.vel).toBeGreaterThan(grubby.vel); // il germoglio è più svelto
  });

  it('è deterministico', () => {
    expect(statsOf(17, MAX_IVS, ['robusto'])).toEqual(statsOf(17, MAX_IVS, ['robusto']));
  });
});

describe('xpToNextLevel', () => {
  it('cresce con il livello e con la curva', () => {
    expect(xpToNextLevel(sprout, 10, config)).toBeGreaterThan(xpToNextLevel(sprout, 5, config));
    // stone_grub ha curva "slow", dew_sprout "medium".
    expect(xpToNextLevel(grub, 10, config)).toBeGreaterThan(xpToNextLevel(sprout, 10, config));
  });
});

describe('knownMoves', () => {
  it('conosce solo le mosse già imparate, al massimo quattro', () => {
    expect(knownMoves(sprout, 1)).toEqual(['colpo', 'rampicante']);
    expect(knownMoves(sprout, 5)).toContain('spora');
    expect(knownMoves(sprout, 40).length).toBeLessThanOrEqual(4);
  });
});

describe('healParty', () => {
  const species = new Map([
    ['dew_sprout', sprout],
    ['stone_grub', grub],
  ]);

  function party() {
    return [
      {
        ...createCreature(
          { species: sprout, level: 8, isAlpha: false, caughtAt: 0 },
          config,
          createRng(1),
        ),
        hp: 0,
        status: 'burned' as const,
      },
      {
        ...createCreature(
          { species: grub, level: 6, isAlpha: false, caughtAt: 0 },
          config,
          createRng(2),
        ),
        hp: 3,
      },
    ];
  }

  /*
   * PDR §5.6: dopo un KO ci si risveglia. Senza questa regola una squadra a
   * zero PV è un vicolo cieco — ogni scontro successivo finirebbe perso in
   * partenza, e l'unica uscita sarebbe cancellare il salvataggio.
   */
  it('rimette tutti agli HP massimi', () => {
    const healed = healParty(party(), species, config);
    for (const member of healed) {
      const entry = species.get(member.speciesId);
      expect(entry).toBeDefined();
      if (entry === undefined) continue;
      expect(member.hp).toBe(maxHp(member, entry, config));
      expect(member.hp).toBeGreaterThan(0);
    }
  });

  it('toglie gli stati alterati', () => {
    const healed = healParty(party(), species, config);
    for (const member of healed) expect(member.status).toBeUndefined();
  });

  it('non tocca livello, IV, tratti e mosse', () => {
    const before = party();
    const healed = healParty(before, species, config);
    healed.forEach((member, index) => {
      const original = before[index];
      expect(original).toBeDefined();
      if (original === undefined) return;
      expect(member.level).toBe(original.level);
      expect(member.ivs).toEqual(original.ivs);
      expect(member.traits).toEqual(original.traits);
      expect(member.moves).toEqual(original.moves);
      expect(member.uid).toBe(original.uid);
    });
  });

  it('lascia intatto un esemplare di specie sconosciuta invece di perderlo', () => {
    const orphan = { ...party()[0], speciesId: 'specie_sparita' } as ReturnType<
      typeof party
    >[number];
    expect(healParty([orphan], species, config)).toEqual([orphan]);
  });
});

describe('generazione di un esemplare', () => {
  it('è riproducibile a parità di seme', () => {
    const a = createCreature(
      { species: sprout, level: 6, isAlpha: false, caughtAt: 0 },
      config,
      createRng(9),
    );
    const b = createCreature(
      { species: sprout, level: 6, isAlpha: false, caughtAt: 0 },
      config,
      createRng(9),
    );
    expect(a).toEqual(b);
  });

  it('nasce con gli HP pieni e le mosse del suo livello', () => {
    const creature = createCreature(
      { species: sprout, level: 9, isAlpha: false, caughtAt: 123 },
      config,
      createRng(3),
    );
    const stats = computeStats(
      { species: sprout, level: 9, ivs: creature.ivs, traits: creature.traits, isAlpha: false },
      config,
    );
    expect(creature.hp).toBe(stats.hp);
    expect(creature.moves).toEqual(knownMoves(sprout, 9));
    expect(creature.caughtAt).toBe(123);
    expect(creature.morale).toBe(100);
  });

  it('gli IV stanno nell intervallo dichiarato', () => {
    const rng = createRng(11);
    for (let i = 0; i < 500; i += 1) {
      const ivs = rollIvs(rng, config);
      for (const key of STAT_KEYS) {
        expect(ivs[key]).toBeGreaterThanOrEqual(0);
        expect(ivs[key]).toBeLessThanOrEqual(config.stats.ivMax);
      }
    }
  });

  it('estrae fra zero e due tratti, mai due volte lo stesso', () => {
    const rng = createRng(21);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const traits = rollTraits(rng, config);
      expect(traits.length).toBeLessThanOrEqual(2);
      expect(new Set(traits).size).toBe(traits.length);
      seen.add(traits.length);
    }
    expect(seen).toEqual(new Set([0, 1, 2]));
  });

  /*
   * L'uid nasce dal RNG seeded e non da `crypto.randomUUID()`: il dominio è
   * puro, e così anche la generazione degli esemplari resta riproducibile.
   */
  it('l uid è univoco in pratica e deterministico dal seme', () => {
    const rng = createRng(5);
    const uids = new Set(Array.from({ length: 5000 }, () => generateUid(rng)));
    expect(uids.size).toBe(5000);
    expect(generateUid(createRng(5))).toBe(generateUid(createRng(5)));
  });
});
