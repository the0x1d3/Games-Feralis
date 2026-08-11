import { describe, expect, it } from 'vitest';
import {
  createRng,
  createStreamStates,
  deriveStreamSeed,
  hashString,
  RNG_STREAM_NAMES,
} from './rng';

describe('createRng', () => {
  it('produce la stessa sequenza a parita di seme', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produce sequenze diverse per semi diversi', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('resta dentro [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 10_000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  /*
   * Questo e' IL test che protegge dal buco B3: salvare solo il seme non basta,
   * perche' al reload la sequenza ripartirebbe da capo.
   */
  it('riprende esattamente da dove era stato salvato', () => {
    const original = createRng(777);
    for (let i = 0; i < 13; i += 1) original.next();

    const saved = original.getState();
    const expected = Array.from({ length: 10 }, () => original.next());

    const restored = createRng(saved);
    const actual = Array.from({ length: 10 }, () => restored.next());

    expect(actual).toEqual(expected);
  });

  it('getState resta un uint32 serializzabile in JSON', () => {
    const rng = createRng(0);
    for (let i = 0; i < 100; i += 1) rng.next();
    const state = rng.getState();
    expect(Number.isInteger(state)).toBe(true);
    expect(JSON.parse(JSON.stringify({ state }))).toEqual({ state });
  });
});

describe('rng.int', () => {
  it('rispetta gli estremi, inclusi', () => {
    const rng = createRng(4);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i += 1) {
      const value = rng.int(1, 6);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
  });

  it('con min === max restituisce sempre quel valore', () => {
    const rng = createRng(4);
    expect(rng.int(3, 3)).toBe(3);
  });

  it('rifiuta un intervallo vuoto', () => {
    const rng = createRng(4);
    expect(() => rng.int(5, 2)).toThrow(RangeError);
  });
});

describe('rng.chance', () => {
  it('e deterministicamente falso a 0 e vero a 1 senza consumare lo stream', () => {
    const rng = createRng(10);
    const before = rng.getState();
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(rng.getState()).toBe(before);
  });

  it('si avvicina alla probabilita richiesta su molti campioni', () => {
    const rng = createRng(2024);
    let hits = 0;
    const samples = 20_000;
    for (let i = 0; i < samples; i += 1) {
      if (rng.chance(0.3)) hits += 1;
    }
    expect(hits / samples).toBeCloseTo(0.3, 1);
  });
});

describe('rng.weighted', () => {
  it('rispetta le proporzioni dei pesi', () => {
    const rng = createRng(555);
    const counts = { comune: 0, raro: 0 };
    const table = [
      { value: 'comune' as const, weight: 90 },
      { value: 'raro' as const, weight: 10 },
    ];
    for (let i = 0; i < 20_000; i += 1) {
      counts[rng.weighted(table)] += 1;
    }
    expect(counts.comune / 20_000).toBeCloseTo(0.9, 1);
  });

  it('ignora le voci con peso zero', () => {
    const rng = createRng(1);
    const table = [
      { value: 'mai', weight: 0 },
      { value: 'sempre', weight: 5 },
    ];
    for (let i = 0; i < 200; i += 1) {
      expect(rng.weighted(table)).toBe('sempre');
    }
  });

  it('lancia se nessuna voce ha peso positivo', () => {
    const rng = createRng(1);
    expect(() => rng.weighted([{ value: 'x', weight: 0 }])).toThrow(RangeError);
  });
});

describe('rng.pick e rng.shuffle', () => {
  it('pick lancia su array vuoto', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });

  it('shuffle non muta l originale e ne conserva gli elementi', () => {
    const rng = createRng(31);
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
  });
});

describe('stream', () => {
  it('assegna a ogni stream un seme diverso', () => {
    const states = createStreamStates(42);
    const unique = new Set(Object.values(states));
    expect(unique.size).toBe(RNG_STREAM_NAMES.length);
  });

  it('e deterministico rispetto al seme master', () => {
    expect(createStreamStates(42)).toEqual(createStreamStates(42));
    expect(createStreamStates(42)).not.toEqual(createStreamStates(43));
  });

  /*
   * Il motivo per cui gli stream esistono: consumare numeri in battaglia non
   * deve spostare l'esito dei prossimi spawn nel mondo.
   */
  it('sono indipendenti fra loro', () => {
    const states = createStreamStates(7);
    const worldA = createRng(states.world);
    const expected = Array.from({ length: 5 }, () => worldA.next());

    const battle = createRng(states.battle);
    for (let i = 0; i < 100; i += 1) battle.next();

    const worldB = createRng(states.world);
    const actual = Array.from({ length: 5 }, () => worldB.next());
    expect(actual).toEqual(expected);
  });

  it('deriveStreamSeed e hashString restano uint32', () => {
    expect(deriveStreamSeed(-1, 'world')).toBeGreaterThanOrEqual(0);
    expect(deriveStreamSeed(-1, 'world')).toBeLessThan(2 ** 32);
    expect(hashString('feralis')).toBe(hashString('feralis'));
    expect(hashString('feralis')).not.toBe(hashString('feralix'));
  });
});
