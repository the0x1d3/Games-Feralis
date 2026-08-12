import { describe, expect, it } from 'vitest';
import encounterData from '@data/world/encounters.json';
import chalkMite from '@data/species/chalk_mite.json';
import emberPup from '@data/species/ember_pup.json';
import sparkMoth from '@data/species/spark_moth.json';
import tideFin from '@data/species/tide_fin.json';
import { parseSpecies, type Species } from '../creature/species';
import { createRng } from '../rng';
import {
  checkEncounter,
  encounterChance,
  encounterTable,
  parseEncounterConfig,
  rollEncounter,
} from './encounters';

const config = parseEncounterConfig(encounterData);

const species: Species[] = (
  [
    ['tide_fin', tideFin],
    ['ember_pup', emberPup],
    ['chalk_mite', chalkMite],
    ['spark_moth', sparkMoth],
  ] as const
).map(([id, raw]) => parseSpecies(raw, id));

describe('encounterChance', () => {
  /*
   * Legata alla distanza e non ai tick: camminare piano non deve essere un
   * modo di evitare gli incontri, e la frequenza non cambia se un giorno il
   * tick cambiasse durata.
   */
  it('cresce con la distanza percorsa', () => {
    expect(encounterChance(0, config)).toBe(0);
    const short = encounterChance(8, config);
    const long = encounterChance(32, config);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeCloseTo(config.chancePerStep, 6);
  });

  it('non supera mai la certezza', () => {
    expect(encounterChance(100_000, config)).toBeLessThanOrEqual(1);
  });

  it('ignora distanze negative o assurde', () => {
    expect(encounterChance(-10, config)).toBe(0);
  });
});

describe('encounterTable', () => {
  it('filtra per bioma', () => {
    const costa = encounterTable(species, 'costa', false).map((entry) => entry.value.id);
    expect(costa).toContain('tide_fin');
    expect(costa).not.toContain('ember_pup');
  });

  /*
   * Le voci notturne sono il motivo per cui il ciclo giorno/notte non è solo
   * una tinta sullo schermo.
   */
  it('la notte cambia chi compare', () => {
    const day = encounterTable(species, 'bosco', false).map((entry) => entry.value.id);
    const night = encounterTable(species, 'bosco', true).map((entry) => entry.value.id);

    expect(day).toContain('ember_pup'); // solo di giorno
    expect(day).not.toContain('spark_moth');
    expect(night).toContain('spark_moth'); // solo di notte
    expect(night).not.toContain('ember_pup');
  });

  it('restituisce una tabella vuota per un bioma senza specie', () => {
    expect(encounterTable(species, 'vulcano', false)).toEqual([]);
  });
});

describe('rollEncounter', () => {
  it('rispetta i pesi', () => {
    const rng = createRng(4);
    const table = encounterTable(species, 'costa', false);
    const counts = new Map<string, number>();

    for (let i = 0; i < 5000; i += 1) {
      const encounter = rollEncounter(table, 'costa', config, rng);
      if (encounter === undefined) continue;
      counts.set(encounter.species.id, (counts.get(encounter.species.id) ?? 0) + 1);
    }

    // tide_fin pesa 45 sulla costa, chalk_mite 20: deve comparire di più.
    expect(counts.get('tide_fin') ?? 0).toBeGreaterThan(counts.get('chalk_mite') ?? 0);
  });

  it('estrae livelli dentro l intervallo del bioma', () => {
    const rng = createRng(8);
    const table = encounterTable(species, 'costa', false);
    const range = config.levelByBiome['costa'];
    expect(range).toBeDefined();

    for (let i = 0; i < 500; i += 1) {
      const encounter = rollEncounter(table, 'costa', config, rng);
      if (encounter === undefined || range === undefined) continue;
      expect(encounter.level).toBeGreaterThanOrEqual(range.min);
      expect(encounter.level).toBeLessThanOrEqual(range.max);
    }
  });

  it('gli Alfa sono rari ma esistono', () => {
    const rng = createRng(31);
    const table = encounterTable(species, 'costa', false);
    let alphas = 0;
    const trials = 20_000;

    for (let i = 0; i < trials; i += 1) {
      if (rollEncounter(table, 'costa', config, rng)?.isAlpha === true) alphas += 1;
    }

    expect(alphas).toBeGreaterThan(0);
    expect(alphas / trials).toBeCloseTo(config.alphaChance, 1);
  });

  it('su una tabella vuota non estrae nulla, senza esplodere', () => {
    expect(rollEncounter([], 'vulcano', config, createRng(1))).toBeUndefined();
  });
});

describe('checkEncounter', () => {
  it('non scatta mai fuori dall erba alta', () => {
    const rng = createRng(2);
    for (let i = 0; i < 500; i += 1) {
      const result = checkEncounter(
        { distancePx: 1000, onEncounterTile: false, biome: 'costa', isNight: false, species },
        config,
        rng,
      );
      expect(result).toBeUndefined();
    }
  });

  it('scatta nell erba alta, con la frequenza attesa', () => {
    const rng = createRng(17);
    let hits = 0;
    const trials = 20_000;

    for (let i = 0; i < trials; i += 1) {
      const result = checkEncounter(
        { distancePx: 32, onEncounterTile: true, biome: 'costa', isNight: false, species },
        config,
        rng,
      );
      if (result !== undefined) hits += 1;
    }

    expect(hits / trials).toBeCloseTo(config.chancePerStep, 1);
  });

  it('è riproducibile a parità di seme', () => {
    const a = createRng(123);
    const b = createRng(123);
    const input = {
      distancePx: 32,
      onEncounterTile: true,
      biome: 'bosco',
      isNight: true,
      species,
    } as const;

    for (let i = 0; i < 50; i += 1) {
      expect(checkEncounter(input, config, a)?.species.id).toBe(
        checkEncounter(input, config, b)?.species.id,
      );
    }
  });
});
