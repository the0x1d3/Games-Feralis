import type { ElementType, Move, StatBlock } from '../creature/species';
import type { Rng } from '../rng';
import type { BattleConfig } from './config';
import { attackMultiplier, resistanceMultiplier, type ActiveStatus } from './status';
import { typeMultiplier } from './typechart';

/**
 * Formula del danno (PDR §5.2).
 *
 *   danno = potenza × ratio × 2 × scalaLivello × tipo × critico × sorpresa × varianza
 *   ratio = att / (att + dif)
 *
 * `ratio = att/(att+dif)` invece di `att/dif` è la scelta che tiene in piedi
 * tutto: si comporta bene fra 0 e 1 qualunque siano le statistiche, quindi non
 * esistono one-shot casuali né combattimenti infiniti, e ribilanciare una
 * specie non può far esplodere il resto.
 *
 * **L'ordine delle estrazioni dal RNG è parte del contratto**: precisione,
 * critico, varianza. Cambiarlo cambia l'esito di ogni combattimento già
 * salvato come seed, e fa fallire i test a seme fisso.
 */

export interface Combatant {
  readonly level: number;
  readonly stats: StatBlock;
  readonly types: readonly ElementType[];
  readonly status?: ActiveStatus | undefined;
}

export interface DamageOptions {
  /** Vero solo al primo turno, dopo un avvicinamento alle spalle (errata E12). */
  readonly hasInitiative: boolean;
}

export interface DamageResult {
  readonly missed: boolean;
  readonly damage: number;
  readonly crit: boolean;
  readonly effectiveness: number;
}

export function critChance(config: BattleConfig): number {
  return config.damage.baseCritChance;
}

export function computeDamage(
  attacker: Combatant,
  defender: Combatant,
  move: Move,
  options: DamageOptions,
  config: BattleConfig,
  rng: Rng,
): DamageResult {
  const effectiveness = typeMultiplier(move.type, defender.types, config);

  if (!rng.chance(move.accuracy)) {
    return { missed: true, damage: 0, crit: false, effectiveness };
  }

  const isElemental = move.category === 'elemental';

  // Bruciato abbassa l'attacco fisico, non quello elementale: è "il braccio
  // che fa male", non la magia.
  const atk = isElemental
    ? attacker.stats.ele
    : attacker.stats.att * attackMultiplier(attacker.status, config);

  // Bagnato abbassa la resistenza al Fulmine (errata E3).
  const def = isElemental
    ? defender.stats.res * resistanceMultiplier(defender.status, move.type, config)
    : defender.stats.dif;

  const { levelScaleDivisor, baseMultiplier, critMultiplier, initiativeMultiplier } = config.damage;
  const { varianceMin, varianceMax } = config.damage;

  const crit = rng.chance(critChance(config));
  const variance = varianceMin + rng.next() * (varianceMax - varianceMin);

  const ratio = atk / (atk + def);
  const levelScale = 1 + attacker.level / levelScaleDivisor;
  const back = options.hasInitiative ? initiativeMultiplier : 1;

  const damage = Math.max(
    1,
    Math.floor(
      move.power *
        ratio *
        baseMultiplier *
        levelScale *
        effectiveness *
        (crit ? critMultiplier : 1) *
        back *
        variance,
    ),
  );

  return { missed: false, damage, crit, effectiveness };
}

/**
 * Danno atteso, senza estrazioni: serve all'IA per scegliere una mossa e alla
 * UI per anticipare l'efficacia. Non deve mai sostituire `computeDamage` nel
 * risolvere un turno, o il combattimento smetterebbe di avere varianza.
 */
export function expectedDamage(
  attacker: Combatant,
  defender: Combatant,
  move: Move,
  config: BattleConfig,
): number {
  const isElemental = move.category === 'elemental';
  const atk = isElemental
    ? attacker.stats.ele
    : attacker.stats.att * attackMultiplier(attacker.status, config);
  const def = isElemental
    ? defender.stats.res * resistanceMultiplier(defender.status, move.type, config)
    : defender.stats.dif;

  const ratio = atk / (atk + def);
  const levelScale = 1 + attacker.level / config.damage.levelScaleDivisor;
  const effectiveness = typeMultiplier(move.type, defender.types, config);

  return (
    move.power * ratio * config.damage.baseMultiplier * levelScale * effectiveness * move.accuracy
  );
}
