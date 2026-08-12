import type { ElementType } from '../creature/species';
import type { BattleConfig } from './config';

/**
 * Due triangoli e un tipo neutro (PDR §5.1).
 *
 *   Flora → Acqua → Fuoco → Flora
 *   Fulmine → Vento → Terra → Fulmine
 *
 * Sei tipi invece di diciotto: bilanciabili da una persona sola, e il giocatore
 * li impara in dieci minuti. I due triangoli non si toccano mai fra loro, il
 * che rende ogni matchup leggibile senza consultare una tabella.
 */

export type Effectiveness = 'advantage' | 'neutral' | 'disadvantage';

/** Moltiplicatore contro un singolo tipo. */
function against(moveType: ElementType, defenderType: ElementType, config: BattleConfig): number {
  const { beats, advantage, disadvantage } = config.types;
  if (beats[moveType] === defenderType) return advantage;
  if (beats[defenderType] === moveType) return disadvantage;
  return 1;
}

/**
 * Contro un doppio tipo i moltiplicatori si moltiplicano (PDR §5.1): 1.5 × 1.5
 * = 2.25 nel caso migliore, 0.66 × 0.66 ≈ 0.44 nel peggiore. Nessuna
 * combinazione produce immunità, quindi nessun matchup è mai senza uscita.
 */
export function typeMultiplier(
  moveType: ElementType,
  defenderTypes: readonly ElementType[],
  config: BattleConfig,
): number {
  let multiplier = 1;
  for (const type of defenderTypes) multiplier *= against(moveType, type, config);
  return multiplier;
}

/**
 * Come si legge il matchup nella UI.
 *
 * Il PDR §7.2 vieta di trasmettere informazione solo con il colore: questa
 * etichetta esiste per accompagnare il colore con una parola e un'icona.
 */
export function effectivenessOf(multiplier: number): Effectiveness {
  if (multiplier > 1.01) return 'advantage';
  if (multiplier < 0.99) return 'disadvantage';
  return 'neutral';
}
