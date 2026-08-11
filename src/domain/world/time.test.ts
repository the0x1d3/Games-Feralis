import { describe, expect, it } from 'vitest';
import {
  advanceClock,
  ambientAt,
  formatClock,
  msPerGameHour,
  phaseAt,
  readClock,
  startingTotalMs,
  type TimeConfig,
} from './time';

const MINUTE = 60_000;

/** Gli stessi numeri di data/world/world.json: 24 minuti reali = un giorno. */
const CONFIG: TimeConfig = {
  dayLengthRealMs: 24 * MINUTE,
  startHour: 8,
  dawnStartHour: 5,
  dayStartHour: 7,
  duskStartHour: 19,
  nightStartHour: 21,
  ambient: [
    { hour: 0, color: 0x000000, alpha: 0.5 },
    { hour: 12, color: 0xffffff, alpha: 0 },
    { hour: 24, color: 0x000000, alpha: 0.5 },
  ],
};

describe('scala del tempo', () => {
  it('un minuto reale vale un ora di gioco', () => {
    expect(msPerGameHour(CONFIG)).toBe(MINUTE);
  });

  it('una partita nuova comincia all ora dichiarata', () => {
    const clock = readClock(startingTotalMs(CONFIG), CONFIG);
    expect(clock.hour).toBe(8);
    expect(clock.minute).toBe(0);
    expect(clock.day).toBe(1);
  });
});

describe('readClock', () => {
  it('conta i giorni a partire da 1', () => {
    expect(readClock(0, CONFIG).day).toBe(1);
    expect(readClock(24 * MINUTE - 1, CONFIG).day).toBe(1);
    expect(readClock(24 * MINUTE, CONFIG).day).toBe(2);
    expect(readClock(72 * MINUTE, CONFIG).day).toBe(4);
  });

  it('ricava ora e minuto', () => {
    const clock = readClock(8 * MINUTE + 30_000, CONFIG);
    expect(clock.hour).toBe(8);
    expect(clock.minute).toBe(30);
    expect(formatClock(clock)).toBe('08:30');
  });

  it('formatta sempre a due cifre', () => {
    expect(formatClock(readClock(5 * MINUTE + 3_000, CONFIG))).toBe('05:03');
  });

  /*
   * Regressione: ricavando il minuto da `(hourFloat - hour) * 60` la virgola
   * mobile restituiva 05:02 al posto di 05:03. Un orologio che sbaglia di un
   * minuto in modo intermittente e' il tipo di bug che si insegue per ore.
   */
  it('non perde un minuto per errore di arrotondamento', () => {
    for (let minute = 0; minute < 60; minute += 1) {
      const clock = readClock(5 * MINUTE + minute * 1000, CONFIG);
      expect(clock.hour).toBe(5);
      expect(clock.minute).toBe(minute);
    }
  });

  it('regge un tempo assurdo nel salvataggio senza esplodere', () => {
    expect(readClock(Number.NaN, CONFIG).hour).toBe(0);
    expect(readClock(-1000, CONFIG).day).toBe(1);
  });
});

describe('phaseAt', () => {
  it('divide la giornata in quattro fasi', () => {
    expect(phaseAt(3, CONFIG)).toBe('night');
    expect(phaseAt(5, CONFIG)).toBe('dawn');
    expect(phaseAt(6.9, CONFIG)).toBe('dawn');
    expect(phaseAt(7, CONFIG)).toBe('day');
    expect(phaseAt(18, CONFIG)).toBe('day');
    expect(phaseAt(19, CONFIG)).toBe('dusk');
    expect(phaseAt(20.9, CONFIG)).toBe('dusk');
    expect(phaseAt(21, CONFIG)).toBe('night');
    expect(phaseAt(23.9, CONFIG)).toBe('night');
  });

  it('copre l intera giornata senza buchi', () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      expect(['dawn', 'day', 'dusk', 'night']).toContain(phaseAt(hour, CONFIG));
    }
  });
});

describe('advanceClock', () => {
  it('somma il tempo trascorso', () => {
    expect(advanceClock(1000, 100)).toBe(1100);
  });

  it('ignora delta non positivi o corrotti', () => {
    expect(advanceClock(1000, -50)).toBe(1000);
    expect(advanceClock(1000, Number.NaN)).toBe(1000);
  });
});

describe('ambientAt', () => {
  it('restituisce i valori esatti sui fotogrammi chiave', () => {
    expect(ambientAt(0, CONFIG.ambient)).toEqual({ color: 0x000000, alpha: 0.5 });
    expect(ambientAt(12, CONFIG.ambient)).toEqual({ color: 0xffffff, alpha: 0 });
  });

  it('interpola fra due fotogrammi', () => {
    const middle = ambientAt(6, CONFIG.ambient);
    expect(middle.alpha).toBeCloseTo(0.25, 6);
    expect(middle.color).toBe(0x808080);
  });

  /*
   * Senza interpolazione la luce cambierebbe a scatti quattro volte al giorno,
   * e si nota subito.
   */
  it('non fa salti bruschi lungo la giornata', () => {
    let previous = ambientAt(0, CONFIG.ambient).alpha;
    for (let hour = 0.1; hour <= 24; hour += 0.1) {
      const current = ambientAt(hour, CONFIG.ambient).alpha;
      expect(Math.abs(current - previous)).toBeLessThan(0.02);
      previous = current;
    }
  });

  it('non esplode con una lista vuota', () => {
    expect(ambientAt(12, [])).toEqual({ color: 0x000000, alpha: 0 });
  });
});
