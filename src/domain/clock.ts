/**
 * Il tempo, come dipendenza iniettata.
 *
 * `src/domain/` non puo' chiamare `Date.now()` (lo vieta ESLint): se lo facesse,
 * i test dipenderebbero dall'ora reale e la simulazione offline non sarebbe
 * verificabile. Qui vive l'interfaccia; l'implementazione reale sta in
 * `src/state/systemClock.ts`, l'unica che tocca l'orologio di sistema.
 */

export interface Clock {
  /** Millisecondi epoch, come `Date.now()`. */
  now(): number;
}

export interface MutableClock extends Clock {
  advance(deltaMs: number): void;
  set(epochMs: number): void;
}

/**
 * Passo fisso della simulazione (PDR §7.1). Nessuna regola di gioco deve
 * dipendere da un `dt` variabile, altrimenti il gioco si comporta diversamente
 * a 30 e a 144 fps.
 *
 * NB: questa e' una costante TECNICA, non di bilanciamento, quindi sta nel
 * codice e non in `/data`.
 */
export const TICK_MS = 100;

/** Quanti tick logici copre un intervallo, piu' il resto da riportare al frame dopo. */
export function ticksIn(elapsedMs: number): { ticks: number; remainderMs: number } {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return { ticks: 0, remainderMs: 0 };
  }
  const ticks = Math.floor(elapsedMs / TICK_MS);
  return { ticks, remainderMs: elapsedMs - ticks * TICK_MS };
}

/**
 * Tempo trascorso dall'ultimo salvataggio, gia' normalizzato secondo le due
 * regole del PDR §5.4:
 *
 *  - se l'orologio e' stato spostato INDIETRO (`elapsed < 0`) il risultato e' 0:
 *    nessuna risorsa, nessuna penalita', nessuna accusa all'utente;
 *  - la produzione offline e' limitata da un cap (8h base, elevabile con le
 *    strutture): serve a dare un motivo per tornare, non a punire chi manca.
 *
 * `capMs` e' un numero di bilanciamento e arriva quindi da `/data`, mai da qui.
 */
export function elapsedSince(
  nowEpochMs: number,
  lastSavedAtEpochMs: number,
  capMs: number,
): number {
  const raw = nowEpochMs - lastSavedAtEpochMs;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, Math.max(0, capMs));
}

/** Orologio controllabile, per i test e per la simulazione offline. */
export function fixedClock(startEpochMs: number): MutableClock {
  let current = startEpochMs;
  return {
    now: () => current,
    advance: (deltaMs: number) => {
      current += deltaMs;
    },
    set: (epochMs: number) => {
      current = epochMs;
    },
  };
}
