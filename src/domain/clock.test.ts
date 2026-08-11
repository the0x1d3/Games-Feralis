import { describe, expect, it } from 'vitest';
import { elapsedSince, fixedClock, TICK_MS, ticksIn } from './clock';

const HOUR = 60 * 60 * 1000;
const CAP_8H = 8 * HOUR;

describe('fixedClock', () => {
  it('parte dal valore dato e avanza solo se glielo chiedi', () => {
    const clock = fixedClock(1_000);
    expect(clock.now()).toBe(1_000);
    clock.advance(500);
    expect(clock.now()).toBe(1_500);
    clock.set(42);
    expect(clock.now()).toBe(42);
  });
});

describe('ticksIn', () => {
  it('divide in tick da 100ms e conserva il resto', () => {
    expect(ticksIn(1_000)).toEqual({ ticks: 10, remainderMs: 0 });
    expect(ticksIn(250)).toEqual({ ticks: 2, remainderMs: 50 });
    // Sotto un tick non si esegue nulla, ma il tempo NON si butta via: torna
    // come resto e si somma al frame successivo. Perdere questi millisecondi
    // farebbe divergere lentamente la simulazione dall'orologio reale.
    expect(ticksIn(TICK_MS - 1)).toEqual({ ticks: 0, remainderMs: 99 });
  });

  it('non perde tempo attraverso frame consecutivi', () => {
    let carry = 0;
    let executed = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      const { ticks, remainderMs } = ticksIn(carry + 16.7);
      executed += ticks;
      carry = remainderMs;
    }
    // 60 frame da 16.7ms = 1002ms: dieci tick pieni, il resto in cassa.
    expect(executed).toBe(10);
    expect(carry).toBeCloseTo(2, 5);
  });

  it('tratta i valori non positivi o non finiti come zero tick', () => {
    expect(ticksIn(0)).toEqual({ ticks: 0, remainderMs: 0 });
    expect(ticksIn(-5_000)).toEqual({ ticks: 0, remainderMs: 0 });
    expect(ticksIn(Number.NaN)).toEqual({ ticks: 0, remainderMs: 0 });
  });
});

describe('elapsedSince', () => {
  it('restituisce il tempo reale trascorso sotto il cap', () => {
    expect(elapsedSince(3 * HOUR, 1 * HOUR, CAP_8H)).toBe(2 * HOUR);
  });

  it('taglia al cap: 20 ore assenti valgono 8 ore di produzione', () => {
    expect(elapsedSince(20 * HOUR, 0, CAP_8H)).toBe(CAP_8H);
  });

  /*
   * PDR §5.4: l'orologio spostato indietro non deve generare risorse NE punire.
   * E' un single-player: chi bara punisce solo se stesso, e chi ha semplicemente
   * cambiato fuso orario non deve accorgersi di nulla.
   */
  it('con orologio spostato indietro restituisce 0, senza penalita', () => {
    expect(elapsedSince(1 * HOUR, 5 * HOUR, CAP_8H)).toBe(0);
  });

  it('restituisce 0 se il tempo non e avanzato', () => {
    expect(elapsedSince(1_000, 1_000, CAP_8H)).toBe(0);
  });

  it('regge un cap elevato dalle strutture avanzate (12h, 24h)', () => {
    expect(elapsedSince(30 * HOUR, 0, 12 * HOUR)).toBe(12 * HOUR);
    expect(elapsedSince(30 * HOUR, 0, 24 * HOUR)).toBe(24 * HOUR);
  });

  it('non esplode con timestamp corrotti nel salvataggio', () => {
    expect(elapsedSince(Number.NaN, 0, CAP_8H)).toBe(0);
    expect(elapsedSince(1_000, Number.NaN, CAP_8H)).toBe(0);
  });

  it('con cap negativo non produce nulla invece di produrre all infinito', () => {
    expect(elapsedSince(5 * HOUR, 0, -1)).toBe(0);
  });
});
