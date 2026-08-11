/**
 * Ciclo giorno/notte.
 *
 * Un giorno di gioco dura 24 minuti reali (PDR §8, Fase 1): un'ora di gioco
 * ogni minuto reale. E' un ritmo che si sente ma non stanca, e rende la
 * meccanica notturna (Nodo notturno ×3.0, lavoratori notturni) qualcosa che
 * capita davvero durante una sessione da 15 minuti invece di una curiosita'.
 *
 * Tutti i numeri arrivano da `data/world/world.json`: qui c'e' solo la regola.
 */

export const HOURS_PER_DAY = 24;
export const MINUTES_PER_HOUR = 60;

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export interface AmbientKeyframe {
  /** Ora del giorno, 0..24. */
  readonly hour: number;
  readonly color: number;
  readonly alpha: number;
}

export interface TimeConfig {
  readonly dayLengthRealMs: number;
  readonly startHour: number;
  readonly dawnStartHour: number;
  readonly dayStartHour: number;
  readonly duskStartHour: number;
  readonly nightStartHour: number;
  readonly ambient: readonly AmbientKeyframe[];
}

export interface WorldClock {
  /** Millisecondi di gioco dall'inizio della partita. E' il valore salvato. */
  readonly totalMs: number;
  /** Giorno, a partire da 1. */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** Ora con la frazione, 0..24: comoda per interpolare la luce. */
  readonly hourFloat: number;
  readonly phase: DayPhase;
}

export interface Ambient {
  readonly color: number;
  readonly alpha: number;
}

export function msPerGameHour(config: TimeConfig): number {
  return config.dayLengthRealMs / HOURS_PER_DAY;
}

/** Istante di partenza di una partita nuova. */
export function startingTotalMs(config: TimeConfig): number {
  return config.startHour * msPerGameHour(config);
}

export function advanceClock(totalMs: number, deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return totalMs;
  return totalMs + deltaMs;
}

export function phaseAt(hourFloat: number, config: TimeConfig): DayPhase {
  if (hourFloat >= config.nightStartHour || hourFloat < config.dawnStartHour) return 'night';
  if (hourFloat < config.dayStartHour) return 'dawn';
  if (hourFloat < config.duskStartHour) return 'day';
  return 'dusk';
}

export function readClock(totalMs: number, config: TimeConfig): WorldClock {
  const safeTotal = Number.isFinite(totalMs) && totalMs > 0 ? totalMs : 0;
  const hourMs = msPerGameHour(config);
  const dayLength = config.dayLengthRealMs;

  const day = Math.floor(safeTotal / dayLength) + 1;
  const intoDay = safeTotal - (day - 1) * dayLength;
  const hourFloat = intoDay / hourMs;

  // Ora e minuto si ricavano dallo STESSO intero di minuti, non dalla frazione
  // di ora: `(hourFloat - hour) * 60` sbaglia per virgola mobile (5.05 dava
  // 2.9999 → 05:02 invece di 05:03) e puo' far disaccordare ora e minuto.
  const totalMinutes = Math.floor(intoDay / (hourMs / MINUTES_PER_HOUR));
  const hour = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minute = totalMinutes - hour * MINUTES_PER_HOUR;

  return { totalMs: safeTotal, day, hour, minute, hourFloat, phase: phaseAt(hourFloat, config) };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(from: number, to: number, t: number): number {
  const r = Math.round(lerp((from >> 16) & 0xff, (to >> 16) & 0xff, t));
  const g = Math.round(lerp((from >> 8) & 0xff, (to >> 8) & 0xff, t));
  const b = Math.round(lerp(from & 0xff, to & 0xff, t));
  return (r << 16) | (g << 8) | b;
}

/**
 * Tinta ambientale interpolata fra i fotogrammi chiave.
 *
 * L'alternativa — quattro colori fissi, uno per fase — produce quattro scatti
 * al giorno che si notano subito. L'interpolazione costa una moltiplicazione.
 */
export function ambientAt(hourFloat: number, keyframes: readonly AmbientKeyframe[]): Ambient {
  if (keyframes.length === 0) return { color: 0x000000, alpha: 0 };

  const first = keyframes[0];
  if (first === undefined) return { color: 0x000000, alpha: 0 };

  let previous = first;
  for (const frame of keyframes) {
    if (frame.hour > hourFloat) {
      const span = frame.hour - previous.hour;
      const t = span <= 0 ? 0 : (hourFloat - previous.hour) / span;
      return {
        color: lerpColor(previous.color, frame.color, t),
        alpha: lerp(previous.alpha, frame.alpha, t),
      };
    }
    previous = frame;
  }
  return { color: previous.color, alpha: previous.alpha };
}

/** Formato "hh:mm" per la HUD. Non e' testo tradotto: sono cifre. */
export function formatClock(clock: WorldClock): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${pad(clock.hour)}:${pad(clock.minute)}`;
}
