import type { Move } from '../creature/species';
import type { Rng } from '../rng';
import type { BattleConfig } from './config';
import { expectedDamage, type Combatant } from './damage';
import { preventsSwitch, type ActiveStatus } from './status';

/**
 * Intelligenza avversaria, tre livelli (PDR §8, Fase 2).
 *
 * Tre livelli e non uno solo perché la stessa IA deve reggere un incontro
 * casuale nell'erba alta e un Custode. E tre e non dieci perché un'IA che il
 * giocatore non riesce a leggere è indistinguibile da una casuale: qui ognuno
 * dei tre ha un comportamento che si riconosce in due combattimenti.
 */

export type AiLevel = 'random' | 'greedy' | 'tactician';

export interface AiActor extends Combatant {
  readonly hp: number;
  readonly moves: readonly Move[];
  readonly status?: ActiveStatus | undefined;
}

export interface AiBench {
  readonly index: number;
  readonly actor: AiActor;
}

export type AiDecision =
  | { readonly kind: 'move'; readonly moveId: string }
  | { readonly kind: 'switch'; readonly index: number };

/** Sotto questa frazione di HP il tattico valuta il cambio. */
const LOW_HP_RATIO = 0.3;

function bestMove(actor: AiActor, target: Combatant, config: BattleConfig): Move | undefined {
  let best: Move | undefined;
  let bestScore = -1;
  for (const move of actor.moves) {
    const score = expectedDamage(actor, target, move, config);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

/**
 * Sceglie l'azione.
 *
 * - `random`: pesca una mossa. È l'avversario dell'erba alta: non punisce,
 *   ma nemmeno regala, perché la varianza esiste comunque.
 * - `greedy`: sceglie sempre il danno atteso più alto. Insegna al giocatore i
 *   triangoli dei tipi, perché lo sfrutta contro di lui.
 * - `tactician`: come greedy, ma cambia esemplare quando è in difficoltà.
 */
export function decide(
  level: AiLevel,
  actor: AiActor,
  target: Combatant,
  bench: readonly AiBench[],
  config: BattleConfig,
  rng: Rng,
): AiDecision {
  if (actor.moves.length === 0) {
    throw new Error('IA: un esemplare senza mosse non può agire');
  }

  if (level === 'random') {
    return { kind: 'move', moveId: rng.pick(actor.moves).id };
  }

  if (level === 'tactician' && !preventsSwitch(actor.status, config)) {
    const lowHp = actor.hp / Math.max(1, actor.stats.hp) < LOW_HP_RATIO;
    const current = bestMove(actor, target, config);
    const currentScore = current === undefined ? 0 : expectedDamage(actor, target, current, config);

    let candidate: AiBench | undefined;
    let candidateScore = currentScore;

    for (const option of bench) {
      const move = bestMove(option.actor, target, config);
      if (move === undefined) continue;
      const score = expectedDamage(option.actor, target, move, config);
      // Si cambia solo per un vantaggio netto: un'IA che entra ed esce di
      // continuo è più fastidiosa che difficile.
      if (score > candidateScore * 1.35) {
        candidate = option;
        candidateScore = score;
      }
    }

    if (candidate !== undefined && (lowHp || candidateScore > currentScore * 1.6)) {
      return { kind: 'switch', index: candidate.index };
    }
  }

  const move = bestMove(actor, target, config);
  if (move === undefined) {
    return { kind: 'move', moveId: rng.pick(actor.moves).id };
  }
  return { kind: 'move', moveId: move.id };
}
