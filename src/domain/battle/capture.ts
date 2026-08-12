import type { Rng } from '../rng';
import type { BattleConfig, CaptureTool } from './config';
import type { ActiveStatus } from './status';

/**
 * Cattura.
 *
 * Primo pilastro del gioco (PDR §1.3): catturare è un puzzle, non un lancio di
 * dado. La percentuale è visibile in tempo reale, e ogni fattore che la
 * migliora è una decisione che il giocatore può prendere: indebolire, applicare
 * uno stato, bagnare il bersaglio, usare un Nodo migliore, aspettare la notte.
 *
 * Sui numeri, vedi l'errata E1 del PDR: con il range originale di
 * `baseCatchRate` (0.10–0.55) una Comune a HP pieni con Nodo base dava il 16.5%,
 * mentre il criterio di accettazione della Fase 2 ne chiede fra 25 e 35. Il
 * range corretto è 0.18 (Alfa) … 1.00 (Comune).
 */

export interface CaptureTarget {
  readonly hp: number;
  readonly maxHp: number;
  readonly level: number;
  readonly baseCatchRate: number;
  readonly status?: ActiveStatus | undefined;
}

export interface CaptureContext {
  /** Livello medio della squadra del giocatore. */
  readonly teamLevel: number;
  readonly isNight: boolean;
}

export interface CaptureBreakdown {
  readonly chance: number;
  readonly hpFactor: number;
  readonly statusFactor: number;
  readonly levelFactor: number;
  readonly toolMultiplier: number;
  /** Falso se lo strumento è notturno e non è notte: la cattura è impossibile. */
  readonly toolUsable: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isToolUsable(tool: CaptureTool, context: CaptureContext): boolean {
  return !tool.nightOnly || context.isNight;
}

/**
 * Scompone la probabilità nei suoi fattori.
 *
 * La UI mostra i singoli fattori e non solo il totale: è così che il giocatore
 * impara che indebolire conta più di qualunque strumento.
 */
export function captureBreakdown(
  target: CaptureTarget,
  tool: CaptureTool,
  context: CaptureContext,
  config: BattleConfig,
): CaptureBreakdown {
  const c = config.capture;
  const hpRatio = target.maxHp <= 0 ? 1 : clamp(target.hp / target.maxHp, 0, 1);

  const hpFactor = 1 - c.hpFactorWeight * hpRatio;

  // Bagnato conta due volte, ed è voluto (errata E2): è lo stato da cattura,
  // e la sinergia Acqua → cattura è una delle poche combo di un roster a sei tipi.
  const statusFactor =
    (target.status === undefined ? 1 : c.statusMultiplier) *
    (target.status?.id === 'wet' ? c.wetMultiplier : 1);

  const levelFactor = clamp(
    1 + c.levelDeltaScale * (context.teamLevel - target.level),
    c.levelDeltaMin,
    c.levelDeltaMax,
  );

  const toolUsable = isToolUsable(tool, context);
  const raw = target.baseCatchRate * tool.multiplier * hpFactor * statusFactor * levelFactor;

  return {
    chance: toolUsable ? clamp(raw, c.minChance, c.maxChance) : 0,
    hpFactor,
    statusFactor,
    levelFactor,
    toolMultiplier: tool.multiplier,
    toolUsable,
  };
}

export function captureChance(
  target: CaptureTarget,
  tool: CaptureTool,
  context: CaptureContext,
  config: BattleConfig,
): number {
  return captureBreakdown(target, tool, context, config).chance;
}

export interface CaptureAttempt {
  readonly captured: boolean;
  readonly chance: number;
  /** Quante scosse mostrare prima dell'esito. */
  readonly shakes: number;
}

/**
 * Tenta la cattura.
 *
 * L'esito si decide **subito**, con una sola estrazione; le scosse sono teatro,
 * non ricalcolo (PDR §5.3). Un'animazione che ripesca a ogni scossa produce
 * una probabilità reale diversa da quella mostrata, ed è il modo più rapido di
 * rendere il primo pilastro una bugia.
 */
export function attemptCapture(
  target: CaptureTarget,
  tool: CaptureTool,
  context: CaptureContext,
  config: BattleConfig,
  rng: Rng,
): CaptureAttempt {
  const chance = captureChance(target, tool, context, config);
  const captured = rng.chance(chance);
  const total = config.capture.shakes;

  // Un fallimento vicino alla riuscita mostra più scosse: informazione onesta,
  // perché deriva dalla stessa probabilità già visibile a schermo.
  const shakes = captured
    ? total
    : Math.min(total - 1, Math.floor(chance * total) + (chance > 0.5 ? 1 : 0));

  return { captured, chance, shakes: Math.max(0, shakes) };
}
