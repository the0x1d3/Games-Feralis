/**
 * RNG deterministico (mulberry32) con stato serializzabile e stream indipendenti.
 *
 * Perche' non `Math.random()`: senza un RNG seeded non esistono test riproducibili,
 * `balance-sim.ts` non e' confrontabile fra due run, e non si possono condividere seed.
 *
 * Perche' lo stato e' serializzabile (risolve il buco B3 del PDR): il salvataggio
 * memorizza `rngSeed`, ma se non memorizzasse anche la POSIZIONE nello stream, al
 * reload la sequenza ripartirebbe dall'inizio e il giocatore rivedrebbe gli stessi
 * esiti. Qui ogni stream espone `getState()` e si ricrea esattamente dov'era.
 *
 * Perche' stream separati: se cattura, spawn e bottino pescassero dallo stesso
 * stream, aprire un menu in piu' cambierebbe l'esito di un combattimento. Gli stream
 * isolano i sottosistemi fra loro.
 */

export const RNG_STREAM_NAMES = ['world', 'battle', 'loot', 'breeding'] as const;

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number];

/** Stato interno di uno stream: un singolo uint32, serializzabile in JSON. */
export type RngState = number;

/** Lo stato di tutti gli stream, cosi' come finisce nel SaveFile. */
export type RngStreamStates = Record<RngStreamName, RngState>;

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Intero in [min, max], estremi inclusi. */
  int(minInclusive: number, maxInclusive: number): number;
  /** Float in [min, max). */
  float(minInclusive: number, maxExclusive: number): number;
  /** true con probabilita' `probability` (0..1). */
  chance(probability: number): boolean;
  /** Un elemento a caso. Lancia se l'array e' vuoto. */
  pick<T>(items: readonly T[]): T;
  /** Estrazione pesata, usata dalle tabelle di spawn. Lancia se i pesi sono tutti <= 0. */
  weighted<T>(entries: readonly WeightedEntry<T>[]): T;
  /** Copia mescolata (Fisher-Yates). Non muta l'input. */
  shuffle<T>(items: readonly T[]): T[];
  /** Stato corrente, da salvare. */
  getState(): RngState;
}

export interface WeightedEntry<T> {
  readonly value: T;
  readonly weight: number;
}

const UINT32 = 0x1_0000_0000;

/** Un passo di mulberry32: dallo stato precedente al prossimo uint32. */
function step(state: RngState): { value: number; state: RngState } {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: (t ^ (t >>> 14)) >>> 0, state: a };
}

/**
 * Hash di una stringa in uint32 (xmur3). Serve a derivare il seme di ogni stream
 * dal seme master, cosi' il salvataggio contiene un solo numero "di partenza".
 */
export function hashString(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seme di uno stream a partire dal seme master della partita. */
export function deriveStreamSeed(masterSeed: number, stream: RngStreamName): RngState {
  return (hashString(stream) ^ (masterSeed | 0)) >>> 0;
}

/** Stato iniziale di tutti gli stream per una partita nuova. */
export function createStreamStates(masterSeed: number): RngStreamStates {
  return {
    world: deriveStreamSeed(masterSeed, 'world'),
    battle: deriveStreamSeed(masterSeed, 'battle'),
    loot: deriveStreamSeed(masterSeed, 'loot'),
    breeding: deriveStreamSeed(masterSeed, 'breeding'),
  };
}

export function createRng(seed: RngState): Rng {
  let state: RngState = seed >>> 0;

  const nextUint32 = (): number => {
    const result = step(state);
    state = result.state;
    return result.value;
  };

  const next = (): number => nextUint32() / UINT32;

  return {
    next,

    int(minInclusive: number, maxInclusive: number): number {
      if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
        throw new RangeError('rng.int richiede estremi interi');
      }
      if (maxInclusive < minInclusive) {
        throw new RangeError(`rng.int: intervallo vuoto [${minInclusive}, ${maxInclusive}]`);
      }
      const span = maxInclusive - minInclusive + 1;
      return minInclusive + Math.floor(next() * span);
    },

    float(minInclusive: number, maxExclusive: number): number {
      return minInclusive + next() * (maxExclusive - minInclusive);
    },

    chance(probability: number): boolean {
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return next() < probability;
    },

    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('rng.pick su un array vuoto');
      const index = Math.floor(next() * items.length);
      const value = items[index];
      if (value === undefined) throw new RangeError('rng.pick: indice fuori intervallo');
      return value;
    },

    weighted<T>(entries: readonly WeightedEntry<T>[]): T {
      let total = 0;
      for (const entry of entries) {
        if (entry.weight > 0) total += entry.weight;
      }
      if (total <= 0) throw new RangeError('rng.weighted: nessuna voce con peso positivo');

      let roll = next() * total;
      for (const entry of entries) {
        if (entry.weight <= 0) continue;
        roll -= entry.weight;
        if (roll < 0) return entry.value;
      }
      // Raggiungibile solo per errori di arrotondamento sull'ultimo elemento.
      const last = entries[entries.length - 1];
      if (last === undefined) throw new RangeError('rng.weighted su un array vuoto');
      return last.value;
    },

    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i];
        const b = copy[j];
        if (a === undefined || b === undefined) continue;
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },

    getState(): RngState {
      return state;
    },
  };
}
