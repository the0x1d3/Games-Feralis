import type { BattleConfig } from './config';
import { speedMultiplier, type ActiveStatus } from './status';

/**
 * Barra ATB.
 *
 * Il PDR §5.2 scriveva `atb += VEL * dt` senza dire cosa fosse `dt`, in
 * conflitto con il passo fisso da 100 ms del §7.1: è l'errata E4. Qui la barra
 * avanza **solo** a tick discreti, e la simulazione si congela quando tocca al
 * giocatore (modalità *wait*).
 *
 * Perché wait e non tempo reale: con la barra che continua a correre mentre si
 * legge il menu, il combattimento smette di essere riproducibile da un seme e
 * `balance-sim` non può più confrontare due run. In più penalizza chi legge
 * lentamente, che non è una meccanica di abilità.
 */

export function atbGain(
  vel: number,
  status: ActiveStatus | undefined,
  config: BattleConfig,
): number {
  return Math.max(0, vel * speedMultiplier(status, config)) * config.atb.tickScale;
}

export function advanceAtb(
  current: number,
  vel: number,
  status: ActiveStatus | undefined,
  config: BattleConfig,
): number {
  return current + atbGain(vel, status, config);
}

export function isReady(atb: number, config: BattleConfig): boolean {
  return atb >= config.atb.threshold;
}

/** Frazione 0..1 da mostrare nella barra. */
export function atbProgress(atb: number, config: BattleConfig): number {
  return Math.max(0, Math.min(1, atb / config.atb.threshold));
}

/** Quanti tick mancano perché tocchi a chi ha questa velocità. Infinito se è fermo. */
export function ticksToReady(
  atb: number,
  vel: number,
  status: ActiveStatus | undefined,
  config: BattleConfig,
): number {
  const gain = atbGain(vel, status, config);
  if (gain <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.ceil((config.atb.threshold - atb) / gain));
}
