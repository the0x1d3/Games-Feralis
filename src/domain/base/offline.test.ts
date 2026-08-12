import { describe, expect, it } from 'vitest';
import baseData from '@data/base.json';
import structureData from '@data/structures.json';
import worldData from '@data/world/world.json';
import { parseWorldConfig } from '../world/config';
import { phaseAt, readClock } from '../world/time';
import { parseBaseConfig, parseStructures } from './config';
import { simulateOffline, msUntilFoodOut, nextSegmentMs, type OfflineContext } from './offline';
import { produce, type Worker } from './production';
import { emptyBase, type BaseState, type PlacedStructure } from './state';

/**
 * L'ADR 0002 messo alla prova.
 *
 * Il criterio di accettazione della Fase 4 chiede che la simulazione a tick e
 * quella a segmenti diano lo **stesso** risultato. Senza questo test la
 * decisione dei segmenti omogenei sarebbe un rischio, non una soluzione — è
 * scritto nell'ADR stesso.
 */

const config = parseBaseConfig(baseData);
const structures = parseStructures(structureData);
const world = parseWorldConfig(worldData);

const context: OfflineContext = {
  config,
  structures,
  time: world.time,
  workers: new Map<string, Worker>([
    ['w1', { uid: 'w1', workLevel: 2, nocturnal: false }],
    ['w2', { uid: 'w2', workLevel: 1, nocturnal: false }],
    ['w3', { uid: 'w3', workLevel: 3, nocturnal: true }],
  ]),
};

function placed(id: string, structureId: string, workerUid?: string): PlacedStructure {
  return {
    id,
    structureId,
    tx: 10,
    ty: 10,
    workUnits: 0,
    ...(workerUid === undefined ? {} : { workerUid }),
  };
}

/** Tre lavoratori assegnati, come nel criterio di accettazione. */
function baseWithWorkers(cibo = 200): BaseState {
  return {
    ...emptyBase(),
    totem: { zoneId: 'costa', tx: 10, ty: 10 },
    structures: [
      placed('a', 'taglialegna', 'w1'),
      placed('b', 'cava', 'w2'),
      placed('c', 'pozzo', 'w3'),
    ],
    resources: { cibo },
    morale: 100,
  };
}

/**
 * La stessa simulazione, ma un secondo per volta.
 *
 * Usa `produce` con le identiche condizioni del percorso a segmenti: è il
 * confronto onesto fra le due granularità, non fra due implementazioni.
 */
function simulateByTicks(
  base: BaseState,
  gameTimeMs: number,
  elapsedMs: number,
  tickMs = 1000,
): { base: BaseState; gameTimeMs: number } {
  let current = base;
  let clock = gameTimeMs;
  let remaining = elapsedMs;

  while (remaining > 0) {
    const step = Math.min(tickMs, remaining);
    const isNight = phaseAt(readClock(clock, world.time).hourFloat, world.time) === 'night';
    current = produce(current, step, context, { isNight, allowInputs: false }).base;
    clock += step;
    remaining -= step;
  }

  return { base: current, gameTimeMs: clock };
}

const EIGHT_HOURS = config.offline.capMs;
const START = world.time.startHour * (world.time.dayLengthRealMs / 24);

describe('tick contro segmenti', () => {
  /*
   * IL test obbligatorio dell'ADR 0002. Se un giorno fallisce, la causa è
   * quasi certamente una condizione che cambia dentro un segmento senza che
   * `nextSegmentMs` la consideri un confine.
   */
  it('otto ore danno esattamente le stesse risorse', () => {
    const start = baseWithWorkers();

    const byTicks = simulateByTicks(start, START, EIGHT_HOURS);
    const bySegments = simulateOffline(
      { base: start, gameTimeMs: START, elapsedMs: EIGHT_HOURS },
      context,
    );

    expect(bySegments.base.resources).toEqual(byTicks.base.resources);
    expect(bySegments.gameTimeMs).toBe(byTicks.gameTimeMs);
  });

  it('coincidono anche su morale, cibo e lavoro accumulato', () => {
    const start = baseWithWorkers(12);

    const byTicks = simulateByTicks(start, START, EIGHT_HOURS);
    const bySegments = simulateOffline(
      { base: start, gameTimeMs: START, elapsedMs: EIGHT_HOURS },
      context,
    );

    expect(bySegments.base.morale).toBe(byTicks.base.morale);
    expect(bySegments.base.foodDebt).toBe(byTicks.base.foodDebt);
    expect(bySegments.base.moraleProgress).toBe(byTicks.base.moraleProgress);
    expect(bySegments.base.structures.map((s) => s.workUnits)).toEqual(
      byTicks.base.structures.map((s) => s.workUnits),
    );
  });

  it('coincidono anche partendo di notte', () => {
    const start = baseWithWorkers();
    const midnight = 0;

    const byTicks = simulateByTicks(start, midnight, EIGHT_HOURS);
    const bySegments = simulateOffline(
      { base: start, gameTimeMs: midnight, elapsedMs: EIGHT_HOURS },
      context,
    );

    expect(bySegments.base.resources).toEqual(byTicks.base.resources);
  });

  it('coincidono anche con il cibo che finisce a metà strada', () => {
    const start = baseWithWorkers(3);

    const byTicks = simulateByTicks(start, START, EIGHT_HOURS);
    const bySegments = simulateOffline(
      { base: start, gameTimeMs: START, elapsedMs: EIGHT_HOURS },
      context,
    );

    expect(bySegments.base.resources).toEqual(byTicks.base.resources);
    expect(bySegments.base.morale).toBe(byTicks.base.morale);
    // Il morale deve essere davvero sceso, o il test non starebbe misurando nulla.
    expect(bySegments.base.morale).toBeLessThan(100);
  });

  it('coincidono anche con tick da 100 ms invece che da un secondo', () => {
    const start = baseWithWorkers();
    const oneHour = 3_600_000;

    const fine = simulateByTicks(start, START, oneHour, 100);
    const coarse = simulateByTicks(start, START, oneHour, 1000);
    const bySegments = simulateOffline(
      { base: start, gameTimeMs: START, elapsedMs: oneHour },
      context,
    );

    expect(coarse.base.resources).toEqual(fine.base.resources);
    expect(bySegments.base.resources).toEqual(fine.base.resources);
  });
});

describe('costo del recupero', () => {
  /*
   * È la ragione per cui l'ADR esiste: otto ore a tick da 100 ms sarebbero
   * 288 000 iterazioni all'apertura della pagina.
   */
  it('otto ore costano poche decine di segmenti, non centinaia di migliaia', () => {
    const result = simulateOffline(
      { base: baseWithWorkers(), gameTimeMs: START, elapsedMs: EIGHT_HOURS },
      context,
    );
    expect(result.segments).toBeGreaterThan(0);
    expect(result.segments).toBeLessThan(60);
  });

  it('non supera mai il tetto dei segmenti', () => {
    const result = simulateOffline(
      { base: baseWithWorkers(), gameTimeMs: START, elapsedMs: 30 * 24 * 3_600_000 },
      context,
    );
    expect(result.segments).toBeLessThanOrEqual(config.offline.maxSegments);
  });
});

describe('confini dei segmenti', () => {
  it('la notte è un confine: dimezza la produzione dei non notturni', () => {
    const start = baseWithWorkers();
    // Due ore DI GIOCO, non due ore reali: un giorno dura 24 minuti, quindi due
    // ore reali coprirebbero cinque giorni interi e i due casi si pareggerebbero.
    const gameHour = world.time.dayLengthRealMs / 24;
    const window = 2 * gameHour;

    const day = simulateOffline(
      { base: start, gameTimeMs: 9 * gameHour, elapsedMs: window },
      context,
    );
    const night = simulateOffline(
      { base: start, gameTimeMs: 22 * gameHour, elapsedMs: window },
      context,
    );

    // Il taglialegna ha un lavoratore diurno: di notte produce meno.
    expect(night.produced['legna'] ?? 0).toBeLessThan(day.produced['legna'] ?? 0);
    // Il pozzo ha un lavoratore notturno: la notte non lo rallenta.
    expect(night.produced['acqua'] ?? 0).toBe(day.produced['acqua'] ?? 0);
  });

  it('calcola quando finisce il cibo', () => {
    const base = baseWithWorkers(1);
    const ms = msUntilFoodOut(base, context);
    // Tre lavoratori a 2 cibo/ora consumano un'unità in dieci minuti.
    expect(ms).toBe(600_000);
  });

  it('senza lavoratori il cibo non finisce mai', () => {
    const idle = { ...baseWithWorkers(), structures: [placed('a', 'taglialegna')] };
    expect(msUntilFoodOut(idle, context)).toBe(Number.POSITIVE_INFINITY);
  });

  it('un segmento non è mai lungo zero', () => {
    const base = baseWithWorkers(0);
    expect(nextSegmentMs(base, START, EIGHT_HOURS, context)).toBeGreaterThan(0);
  });
});

describe('regole del recupero offline', () => {
  it('senza Totem non produce nulla', () => {
    const { totem: _scarta, ...noTotem } = baseWithWorkers();
    const result = simulateOffline(
      { base: noTotem, gameTimeMs: START, elapsedMs: EIGHT_HOURS },
      context,
    );
    expect(result.produced).toEqual({});
  });

  it('senza lavoratori assegnati non produce nulla', () => {
    const idle: BaseState = {
      ...baseWithWorkers(),
      structures: [placed('a', 'taglialegna'), placed('b', 'cava')],
    };
    const result = simulateOffline(
      { base: idle, gameTimeMs: START, elapsedMs: EIGHT_HOURS },
      context,
    );
    expect(result.produced).toEqual({});
    expect(result.base.morale).toBe(100);
  });

  /*
   * ADR 0006: le lavorazioni con ingredienti si fermano mentre non ci sei.
   * Senza questa regola una catena miniera → fornace dipenderebbe dall'ordine
   * in cui si simula il tempo, e l'uguaglianza qui sopra non sarebbe
   * dimostrabile.
   */
  it('le lavorazioni con ingredienti si fermano', () => {
    const smelting: BaseState = {
      ...emptyBase(),
      totem: { zoneId: 'costa', tx: 10, ty: 10 },
      structures: [placed('f', 'fornace', 'w1')],
      resources: { cibo: 100, minerale: 100 },
      morale: 100,
    };

    const result = simulateOffline(
      { base: smelting, gameTimeMs: START, elapsedMs: EIGHT_HOURS },
      context,
    );
    expect(result.produced['lingotto']).toBeUndefined();
    expect(result.base.resources['minerale']).toBe(100);
  });

  it('un tempo trascorso nullo o negativo non genera nulla', () => {
    for (const elapsed of [0, -5000]) {
      const result = simulateOffline(
        { base: baseWithWorkers(), gameTimeMs: START, elapsedMs: elapsed },
        context,
      );
      expect(result.produced).toEqual({});
      expect(result.segments).toBe(0);
      expect(result.gameTimeMs).toBe(START);
    }
  });
});
