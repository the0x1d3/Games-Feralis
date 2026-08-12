import { describe, expect, it } from 'vitest';
import battleData from '@data/battle.json';
import creatureData from '@data/creatures.json';
import { createRng } from '../rng';
import { attemptCapture, captureBreakdown, captureChance, type CaptureTarget } from './capture';
import { parseBattleConfig, type CaptureTool } from './config';
import { parseCreatureConfig } from '../creature/stats';

const config = parseBattleConfig(battleData);
const creatures = parseCreatureConfig(creatureData);

function tool(id: string): CaptureTool {
  const found = config.tools.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Nodo assente da battle.json: ${id}`);
  return found;
}

const BASE = tool('nodo_base');
const NIGHT = tool('nodo_notturno');

function target(overrides: Partial<CaptureTarget> = {}): CaptureTarget {
  return {
    hp: 100,
    maxHp: 100,
    level: 8,
    baseCatchRate: creatures.rarity.common.baseCatchRate,
    ...overrides,
  };
}

const DAY = { teamLevel: 8, isNight: false };
const NIGHT_CTX = { teamLevel: 8, isNight: true };

describe('criterio di accettazione della Fase 2', () => {
  /*
   * "A HP pieni una Comune con Nodo base ha 25–35% di cattura."
   *
   * Con i valori originali del PDR (baseCatchRate 0.10–0.55) il risultato era
   * 16.5% e il criterio era irraggiungibile: è l'errata E1. Questo test è la
   * ragione per cui la correzione non può tornare indietro per sbaglio.
   */
  it('una Comune a HP pieni con Nodo base sta fra il 25% e il 35%', () => {
    const chance = captureChance(target(), BASE, DAY, config);
    expect(chance).toBeGreaterThanOrEqual(0.25);
    expect(chance).toBeLessThanOrEqual(0.35);
  });

  it('la tabella delle rarità è coerente con la formula', () => {
    for (const rarity of ['common', 'uncommon', 'rare', 'alpha'] as const) {
      const chance = captureChance(
        target({ baseCatchRate: creatures.rarity[rarity].baseCatchRate }),
        BASE,
        DAY,
        config,
      );
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThan(1);
    }
  });
});

describe('indebolire conta', () => {
  it('la probabilità cresce al calare degli HP', () => {
    const full = captureChance(target({ hp: 100 }), BASE, DAY, config);
    const half = captureChance(target({ hp: 50 }), BASE, DAY, config);
    const sliver = captureChance(target({ hp: 1 }), BASE, DAY, config);

    expect(half).toBeGreaterThan(full);
    expect(sliver).toBeGreaterThan(half);
  });

  it('è monotona: nessun punto in cui indebolire peggiora le cose', () => {
    let previous = 0;
    for (let hp = 100; hp >= 1; hp -= 1) {
      const chance = captureChance(target({ hp }), BASE, DAY, config);
      expect(chance).toBeGreaterThanOrEqual(previous);
      previous = chance;
    }
  });
});

describe('stati alterati', () => {
  it('uno stato qualsiasi migliora la cattura', () => {
    const plain = captureChance(target({ hp: 40 }), BASE, DAY, config);
    const burned = captureChance(
      target({ hp: 40, status: { id: 'burned', turnsLeft: 3 } }),
      BASE,
      DAY,
      config,
    );
    expect(burned).toBeGreaterThan(plain);
  });

  /*
   * Bagnato conta due volte, ed è voluto (errata E2): è lo stato da cattura, e
   * dà un senso tattico alle mosse d'Acqua oltre al danno.
   */
  it('Bagnato è lo stato migliore per catturare', () => {
    const burned = captureBreakdown(
      target({ hp: 40, status: { id: 'burned', turnsLeft: 3 } }),
      BASE,
      DAY,
      config,
    );
    const wet = captureBreakdown(
      target({ hp: 40, status: { id: 'wet', turnsLeft: 3 } }),
      BASE,
      DAY,
      config,
    );
    expect(wet.statusFactor).toBeGreaterThan(burned.statusFactor);
    expect(wet.statusFactor).toBeCloseTo(1.25 * 1.15, 6);
  });
});

describe('strumenti', () => {
  it('un Nodo migliore aumenta la probabilità', () => {
    const base = captureChance(target({ hp: 60 }), BASE, DAY, config);
    const better = captureChance(target({ hp: 60 }), tool('nodo_migliorato'), DAY, config);
    expect(better).toBeGreaterThan(base);
  });

  it('il Nodo notturno non funziona di giorno', () => {
    const day = captureBreakdown(target({ hp: 60 }), NIGHT, DAY, config);
    expect(day.toolUsable).toBe(false);
    expect(day.chance).toBe(0);

    const night = captureBreakdown(target({ hp: 60 }), NIGHT, NIGHT_CTX, config);
    expect(night.toolUsable).toBe(true);
    expect(night.chance).toBeGreaterThan(0);
  });
});

describe('limiti', () => {
  it('non è mai 0% né mai garantita', () => {
    const impossible = captureChance(
      target({ baseCatchRate: 0.01, level: 40 }),
      BASE,
      { teamLevel: 1, isNight: false },
      config,
    );
    expect(impossible).toBeGreaterThanOrEqual(config.capture.minChance);

    const easy = captureChance(target({ hp: 1 }), tool('nodo_superiore'), DAY, config);
    expect(easy).toBeLessThanOrEqual(config.capture.maxChance);
  });

  it('un bersaglio molto più alto di livello è più difficile', () => {
    const even = captureChance(target({ hp: 50, level: 8 }), BASE, DAY, config);
    const higher = captureChance(target({ hp: 50, level: 25 }), BASE, DAY, config);
    expect(higher).toBeLessThan(even);
  });
});

describe('attemptCapture', () => {
  /*
   * L'esito si decide con UNA estrazione, e le scosse sono teatro (PDR §5.3).
   * Se l'animazione ripescasse a ogni scossa, la probabilità reale sarebbe
   * diversa da quella mostrata, e il primo pilastro diventerebbe una bugia.
   */
  it('la frequenza osservata coincide con la percentuale mostrata', () => {
    const rng = createRng(4242);
    const subject = target({ hp: 30 });
    const expected = captureChance(subject, BASE, DAY, config);

    let captured = 0;
    const trials = 20_000;
    for (let i = 0; i < trials; i += 1) {
      if (attemptCapture(subject, BASE, DAY, config, rng).captured) captured += 1;
    }

    expect(captured / trials).toBeCloseTo(expected, 1);
  });

  it('è riproducibile a parità di seme', () => {
    const a = createRng(7);
    const b = createRng(7);
    const subject = target({ hp: 30 });
    expect(attemptCapture(subject, BASE, DAY, config, a)).toEqual(
      attemptCapture(subject, BASE, DAY, config, b),
    );
  });

  it('mostra tutte le scosse solo quando riesce', () => {
    const rng = createRng(1);
    const subject = target({ hp: 1 });
    for (let i = 0; i < 200; i += 1) {
      const attempt = attemptCapture(subject, tool('nodo_superiore'), DAY, config, rng);
      if (attempt.captured) expect(attempt.shakes).toBe(config.capture.shakes);
      else expect(attempt.shakes).toBeLessThan(config.capture.shakes);
    }
  });
});
