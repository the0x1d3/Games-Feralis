import { msUntilNightBoundary, phaseAt, readClock, type TimeConfig } from '../world/time';
import {
  isFed,
  moraleBand,
  produce,
  type ProductionContext,
  type ProduceResult,
} from './production';
import { MS_PER_HOUR, resourceOf, type BaseState } from './state';

/**
 * Recupero della produzione mentre il giocatore non c'era.
 *
 * È l'ADR 0002 messo alla prova. Otto ore a tick da 100 ms sarebbero 288 000
 * iterazioni all'apertura della pagina, cioè un blocco di calcolo nel momento
 * peggiore. Una formula chiusa darebbe invece numeri diversi da quelli della
 * simulazione online, perché il ciclo giorno/notte alterna una ventina di volte
 * in otto ore.
 *
 * La soluzione: il tempo si spezza in **segmenti omogenei**, e dentro ognuno le
 * condizioni non cambiano. Stessa funzione `produce`, chiamata poche decine di
 * volte invece di trecentomila.
 *
 * Un segmento finisce quando cambia qualcosa che influenza la velocità:
 *  1. il passaggio giorno ↔ notte;
 *  2. l'esaurimento del cibo (cambia la sazietà, e con essa il morale);
 *  3. il superamento di una soglia di morale;
 *  4. la fine del tempo da recuperare.
 */

export interface OfflineContext extends ProductionContext {
  readonly time: TimeConfig;
}

export interface OfflineInput {
  readonly base: BaseState;
  readonly gameTimeMs: number;
  /** Già limitato dal cap: se lo passi crudo, il cap non viene applicato. */
  readonly elapsedMs: number;
}

export interface OfflineResult {
  readonly base: BaseState;
  readonly gameTimeMs: number;
  readonly produced: Readonly<Record<string, number>>;
  readonly consumed: Readonly<Record<string, number>>;
  /** Quanti segmenti sono serviti: è la misura del guadagno rispetto ai tick. */
  readonly segments: number;
  readonly elapsedMs: number;
}

function activeWorkers(base: BaseState, context: ProductionContext): number {
  return base.structures.filter((structure) => {
    if (structure.workerUid === undefined) return false;
    return context.structures.get(structure.structureId)?.kind === 'producer';
  }).length;
}

/** Millisecondi prima che il cibo finisca. Infinito se non si sta consumando. */
export function msUntilFoodOut(base: BaseState, context: OfflineContext): number {
  const workers = activeWorkers(base, context);
  if (workers <= 0 || !isFed(base)) return Number.POSITIVE_INFINITY;

  const perMs = workers * context.config.food.perWorkerPerHour;
  if (perMs <= 0) return Number.POSITIVE_INFINITY;

  const remaining = resourceOf(base, 'cibo') * MS_PER_HOUR - base.foodDebt;
  return Math.max(1, Math.ceil(remaining / perMs));
}

/** Millisecondi prima che il morale cambi fascia. */
export function msUntilMoraleBandChange(base: BaseState, context: OfflineContext): number {
  const workers = activeWorkers(base, context);
  if (workers <= 0) return Number.POSITIVE_INFINITY;

  const fed = isFed(base);
  const rate = fed
    ? context.config.food.moraleRecoverPerHour
    : context.config.food.moraleDecayPerHour;
  if (rate <= 0) return Number.POSITIVE_INFINITY;

  const band = moraleBand(base.morale, context.config);
  const step = fed ? 1 : -1;

  let target = base.morale;
  for (;;) {
    target += step;
    if (target < 0 || target > 100) return Number.POSITIVE_INFINITY;
    if (moraleBand(target, context.config) !== band) break;
  }

  const points = Math.abs(target - base.morale);
  // Il progresso già accumulato nella direzione corrente accorcia l'attesa.
  const already = fed ? base.moraleProgress : -base.moraleProgress;
  return Math.max(1, Math.ceil((points * MS_PER_HOUR - already) / rate));
}

/** La lunghezza del prossimo segmento omogeneo. */
export function nextSegmentMs(
  base: BaseState,
  gameTimeMs: number,
  remainingMs: number,
  context: OfflineContext,
): number {
  return Math.max(
    1,
    Math.min(
      remainingMs,
      msUntilNightBoundary(gameTimeMs, context.time),
      msUntilFoodOut(base, context),
      msUntilMoraleBandChange(base, context),
    ),
  );
}

function merge(target: Record<string, number>, source: Readonly<Record<string, number>>): void {
  for (const [id, amount] of Object.entries(source)) {
    target[id] = (target[id] ?? 0) + amount;
  }
}

export function simulateOffline(input: OfflineInput, context: OfflineContext): OfflineResult {
  const produced: Record<string, number> = {};
  const consumed: Record<string, number> = {};

  let base = input.base;
  let gameTimeMs = input.gameTimeMs;
  let remaining = Math.max(0, Math.floor(input.elapsedMs));
  let segments = 0;

  while (remaining > 0 && segments < context.config.offline.maxSegments) {
    const step = nextSegmentMs(base, gameTimeMs, remaining, context);
    const isNight = phaseAt(readClock(gameTimeMs, context.time).hourFloat, context.time) === 'night';

    const result: ProduceResult = produce(base, step, context, { isNight, allowInputs: false });
    base = result.base;
    merge(produced, result.produced);
    merge(consumed, result.consumed);

    gameTimeMs += step;
    remaining -= step;
    segments += 1;
  }

  return {
    base,
    gameTimeMs,
    produced,
    consumed,
    segments,
    elapsedMs: Math.max(0, Math.floor(input.elapsedMs)) - remaining,
  };
}
