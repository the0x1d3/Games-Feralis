import type { CreatureInstance } from './instance';
import { knownMoves, type Species } from './species';
import { computeStats, type CreatureConfig } from './stats';

/**
 * Evoluzione.
 *
 * Un esemplare evoluto resta **lo stesso esemplare**: conserva uid, IV, tratti,
 * soprannome e stato Alfa. Cambia solo la specie, e con essa le statistiche
 * base. Sostituirlo con uno nuovo sarebbe più semplice da scrivere e
 * distruggerebbe il senso di aver cresciuto proprio quello.
 */

export interface EvolutionOutcome {
  readonly creature: CreatureInstance;
  readonly fromSpeciesId: string;
  readonly toSpeciesId: string;
}

/** La specie in cui questo esemplare può evolvere adesso, se ce n'è una. */
export function pendingEvolution(
  creature: CreatureInstance,
  species: Species,
  registry: ReadonlyMap<string, Species>,
): Species | undefined {
  const evolution = species.evolution;
  if (evolution === undefined || creature.level < evolution.level) return undefined;
  return registry.get(evolution.toId);
}

export function canEvolve(
  creature: CreatureInstance,
  species: Species,
  registry: ReadonlyMap<string, Species>,
): boolean {
  return pendingEvolution(creature, species, registry) !== undefined;
}

/**
 * Fa evolvere l'esemplare.
 *
 * Gli HP correnti si riscalano sulla nuova soglia mantenendo la stessa
 * frazione: evolvere non è una cura, ma nemmeno un danno. Un esemplare a terra
 * resta a terra.
 */
export function evolve(
  creature: CreatureInstance,
  from: Species,
  to: Species,
  config: CreatureConfig,
): EvolutionOutcome {
  const statsBefore = computeStats(
    {
      species: from,
      level: creature.level,
      ivs: creature.ivs,
      traits: creature.traits,
      isAlpha: creature.isAlpha,
    },
    config,
  );
  const statsAfter = computeStats(
    {
      species: to,
      level: creature.level,
      ivs: creature.ivs,
      traits: creature.traits,
      isAlpha: creature.isAlpha,
    },
    config,
  );

  const ratio = statsBefore.hp <= 0 ? 1 : Math.max(0, creature.hp) / statsBefore.hp;
  const hp = creature.hp <= 0 ? 0 : Math.max(1, Math.round(statsAfter.hp * ratio));

  // Le mosse già imparate restano; la nuova specie ne aggiunge se il livello
  // raggiunto ne prevede altre.
  const moves = [...creature.moves];
  for (const move of knownMoves(to, creature.level)) {
    if (!moves.includes(move) && moves.length < 4) moves.push(move);
  }

  return {
    creature: { ...creature, speciesId: to.id, hp, moves },
    fromSpeciesId: from.id,
    toSpeciesId: to.id,
  };
}
