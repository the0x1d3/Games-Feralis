import { describe, expect, it } from 'vitest';
import creatureData from '@data/creatures.json';
import dewSprout from '@data/species/dew_sprout.json';
import emberPup from '@data/species/ember_pup.json';
import verdantStalk from '@data/species/verdant_stalk.json';
import { createRng } from '../rng';
import { canEvolve, evolve, pendingEvolution } from './evolution';
import { createCreature, maxHp, type CreatureInstance } from './instance';
import { parseSpecies, type Species } from './species';
import { computeStats, parseCreatureConfig, xpToNextLevel } from './stats';
import { grantXp, levelProgress, splitXp, xpFromOpponent } from './xp';

const config = parseCreatureConfig(creatureData);
const sprout = parseSpecies(dewSprout, 'dew_sprout');
const stalk = parseSpecies(verdantStalk, 'verdant_stalk');
const pup = parseSpecies(emberPup, 'ember_pup');

const registry = new Map<string, Species>([
  ['dew_sprout', sprout],
  ['verdant_stalk', stalk],
  ['ember_pup', pup],
]);

function make(level = 5, species = sprout, seed = 7): CreatureInstance {
  return createCreature({ species, level, isAlpha: false, caughtAt: 0 }, config, createRng(seed));
}

describe('esperienza da un avversario', () => {
  it('cresce con il livello dell avversario', () => {
    expect(xpFromOpponent(10, false, config)).toBeGreaterThan(xpFromOpponent(4, false, config));
  });

  it('un Alfa ne vale il doppio', () => {
    expect(xpFromOpponent(8, true, config)).toBe(
      xpFromOpponent(8, false, config) * config.xp.alphaMultiplier,
    );
  });

  it('chi ha combattuto prende più di chi era in panchina', () => {
    const share = splitXp(1000, config);
    expect(share.active).toBe(1000);
    expect(share.bench).toBeLessThan(share.active);
    expect(share.bench).toBeGreaterThan(0);
  });
});

describe('grantXp', () => {
  it('accumula senza salire finché non basta', () => {
    const creature = make(5);
    const needed = xpToNextLevel(sprout, 5, config);
    const result = grantXp(creature, needed - 1, sprout, config);

    expect(result.levelUp).toBeUndefined();
    expect(result.creature.level).toBe(5);
    expect(result.creature.xp).toBe(needed - 1);
  });

  it('sale di livello e conserva il resto', () => {
    const creature = make(5);
    const needed = xpToNextLevel(sprout, 5, config);
    const result = grantXp(creature, needed + 10, sprout, config);

    expect(result.levelUp?.to).toBe(6);
    expect(result.creature.level).toBe(6);
    expect(result.creature.xp).toBe(10);
  });

  /* Con un Alfa sconfitto a livello basso può capitare davvero. */
  it('sale di più livelli in un colpo solo', () => {
    const result = grantXp(make(5), 100_000, sprout, config);
    expect(result.creature.level).toBeGreaterThan(7);
    expect(result.levelUp?.from).toBe(5);
    expect(result.levelUp?.to).toBe(result.creature.level);
  });

  it('impara le mosse previste dal livello', () => {
    const creature = { ...make(4), moves: ['colpo', 'rampicante'] };
    const result = grantXp(creature, 100_000, sprout, config);
    expect(result.creature.moves).toContain('spora');
    expect(result.creature.moves.length).toBeLessThanOrEqual(4);
  });

  /*
   * Salire di livello non cura: altrimenti vincere sarebbe anche un modo
   * gratuito di rimettersi in sesto, e gestire la squadra perderebbe peso.
   */
  it('non rimette in salute chi è ferito', () => {
    const hurt = { ...make(5), hp: 30 };
    const result = grantXp(hurt, 100_000, sprout, config);
    const full = maxHp(result.creature, sprout, config);
    expect(result.creature.hp).toBeLessThan(full);
  });

  it('accredita però gli HP massimi guadagnati salendo', () => {
    const hurt = { ...make(5), hp: 30 };
    const before = maxHp(hurt, sprout, config);
    const result = grantXp(hurt, xpToNextLevel(sprout, 5, config), sprout, config);
    const after = maxHp(result.creature, sprout, config);

    expect(after).toBeGreaterThan(before);
    expect(result.creature.hp).toBe(30 + (after - before));
  });

  it('un esemplare a terra resta a terra', () => {
    const fainted = { ...make(5), hp: 0 };
    expect(grantXp(fainted, 100_000, sprout, config).creature.hp).toBe(0);
  });

  it('si ferma al livello massimo', () => {
    const result = grantXp(make(config.maxLevel), 999_999, sprout, config);
    expect(result.creature.level).toBe(config.maxLevel);
  });

  it('ignora quantità nulle o negative', () => {
    const creature = make(5);
    expect(grantXp(creature, 0, sprout, config).creature).toEqual(creature);
    expect(grantXp(creature, -50, sprout, config).creature).toEqual(creature);
  });

  it('levelProgress resta fra 0 e 1', () => {
    const creature = make(5);
    expect(levelProgress(creature, sprout, config)).toBe(0);
    const half = { ...creature, xp: Math.floor(xpToNextLevel(sprout, 5, config) / 2) };
    expect(levelProgress(half, sprout, config)).toBeCloseTo(0.5, 1);
  });
});

describe('evoluzione', () => {
  it('non scatta prima della soglia', () => {
    expect(pendingEvolution(make(11), sprout, registry)).toBeUndefined();
    expect(canEvolve(make(11), sprout, registry)).toBe(false);
  });

  it('scatta alla soglia dichiarata dalla specie', () => {
    const threshold = sprout.evolution?.level ?? 0;
    expect(threshold).toBeGreaterThan(0);
    expect(pendingEvolution(make(threshold), sprout, registry)?.id).toBe('verdant_stalk');
  });

  it('una specie senza evoluzione non evolve mai', () => {
    expect(pendingEvolution(make(40, stalk), stalk, registry)).toBeUndefined();
  });

  /*
   * L'esemplare evoluto è LO STESSO esemplare: sostituirlo con uno nuovo
   * sarebbe più semplice da scrivere e cancellerebbe il senso di averlo cresciuto.
   */
  it('conserva identità, IV, tratti e soprannome', () => {
    const before = { ...make(12), nickname: 'Foglia' };
    const after = evolve(before, sprout, stalk, config).creature;

    expect(after.uid).toBe(before.uid);
    expect(after.ivs).toEqual(before.ivs);
    expect(after.traits).toEqual(before.traits);
    expect(after.nickname).toBe('Foglia');
    expect(after.level).toBe(before.level);
    expect(after.speciesId).toBe('verdant_stalk');
  });

  it('le statistiche diventano quelle della nuova specie', () => {
    const before = make(12);
    const after = evolve(before, sprout, stalk, config).creature;

    const statsBefore = computeStats(
      { species: sprout, level: 12, ivs: before.ivs, traits: before.traits, isAlpha: false },
      config,
    );
    const statsAfter = computeStats(
      { species: stalk, level: 12, ivs: after.ivs, traits: after.traits, isAlpha: false },
      config,
    );
    expect(statsAfter.ele).toBeGreaterThan(statsBefore.ele);
  });

  it('conserva la frazione di vita: non cura e non ferisce', () => {
    const before = { ...make(12), hp: Math.floor(maxHp(make(12), sprout, config) / 2) };
    const after = evolve(before, sprout, stalk, config).creature;
    const ratioBefore = before.hp / maxHp(before, sprout, config);
    const ratioAfter = after.hp / maxHp(after, stalk, config);
    expect(ratioAfter).toBeCloseTo(ratioBefore, 2);
  });

  it('un esemplare a terra resta a terra anche evolvendo', () => {
    const fainted = { ...make(12), hp: 0 };
    expect(evolve(fainted, sprout, stalk, config).creature.hp).toBe(0);
  });

  it('aggiunge le mosse della nuova specie se ci sono slot liberi', () => {
    const before = { ...make(12), moves: ['colpo'] };
    const after = evolve(before, sprout, stalk, config).creature;
    expect(after.moves.length).toBeGreaterThan(1);
    expect(after.moves.length).toBeLessThanOrEqual(4);
  });
});

describe('dal livello 5 all evoluzione', () => {
  /*
   * Il criterio di accettazione della Fase 3: "ne evolvi una". Qui si verifica
   * che il percorso esista davvero, e quanti scontri costa.
   */
  it('si arriva alla soglia con un numero ragionevole di scontri', () => {
    const threshold = sprout.evolution?.level ?? 12;
    let creature = make(5);
    let battles = 0;

    while (creature.level < threshold && battles < 500) {
      creature = grantXp(creature, xpFromOpponent(6, false, config), sprout, config).creature;
      battles += 1;
    }

    expect(creature.level).toBeGreaterThanOrEqual(threshold);
    expect(battles).toBeLessThan(80);
    expect(canEvolve(creature, sprout, registry)).toBe(true);
  });
});
