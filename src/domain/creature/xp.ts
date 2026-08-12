import type { CreatureInstance } from './instance';
import { knownMoves, type Species } from './species';
import { computeStats, xpToNextLevel, type CreatureConfig } from './stats';

/**
 * Esperienza e livelli.
 *
 * Regola di fondo: salire di livello **non cura**. Le statistiche si
 * ricalcolano (errata E7) e gli HP massimi crescono, ma quelli correnti
 * restano dove sono — altrimenti vincere uno scontro sarebbe anche un modo
 * gratuito di rimettersi in sesto, e la gestione della squadra perderebbe
 * ogni peso.
 *
 * L'unica eccezione è il guadagno secco di HP massimi: quel delta viene
 * accreditato, perché toglierlo significherebbe che salire di livello
 * *abbassa* la frazione di vita rimasta.
 */

export interface LevelUp {
  readonly from: number;
  readonly to: number;
  /** Mosse imparate salendo. */
  readonly learned: readonly string[];
}

export interface XpResult {
  readonly creature: CreatureInstance;
  readonly levelUp?: LevelUp;
}

/** Esperienza per aver sconfitto o catturato un avversario. */
export function xpFromOpponent(level: number, isAlpha: boolean, config: CreatureConfig): number {
  const base = config.xp.fromDefeat * Math.max(1, level);
  return Math.floor(base * (isAlpha ? config.xp.alphaMultiplier : 1));
}

/**
 * Accredita esperienza, facendo salire di livello quante volte serve.
 *
 * Il ciclo gestisce più livelli in un colpo solo: con un Alfa sconfitto a
 * livello basso può capitare, e vedersi assegnare un livello solo sarebbe una
 * perdita silenziosa.
 */
export function grantXp(
  creature: CreatureInstance,
  amount: number,
  species: Species,
  config: CreatureConfig,
): XpResult {
  if (amount <= 0 || creature.level >= config.maxLevel) {
    return { creature };
  }

  let level = creature.level;
  let xp = creature.xp + Math.floor(amount);
  const learned: string[] = [];

  while (level < config.maxLevel) {
    const needed = xpToNextLevel(species, level, config);
    if (xp < needed) break;
    xp -= needed;
    level += 1;

    const before = new Set(knownMoves(species, level - 1));
    for (const move of knownMoves(species, level)) {
      if (!before.has(move)) learned.push(move);
    }
  }

  if (level === creature.level) {
    return { creature: { ...creature, xp } };
  }

  // Gli HP massimi guadagnati salendo si accreditano anche a quelli correnti:
  // senza, un livello in più farebbe scendere la percentuale di vita.
  const hpBefore = computeStats(
    {
      species,
      level: creature.level,
      ivs: creature.ivs,
      traits: creature.traits,
      isAlpha: creature.isAlpha,
    },
    config,
  ).hp;
  const hpAfter = computeStats(
    { species, level, ivs: creature.ivs, traits: creature.traits, isAlpha: creature.isAlpha },
    config,
  ).hp;

  const hp =
    creature.hp <= 0 ? 0 : Math.min(hpAfter, creature.hp + Math.max(0, hpAfter - hpBefore));
  const moves = mergeMoves(creature.moves, learned);

  return {
    creature: { ...creature, level, xp: level >= config.maxLevel ? 0 : xp, hp, moves },
    levelUp: { from: creature.level, to: level, learned },
  };
}

/**
 * Aggiunge le mosse nuove tenendo il massimo di quattro slot.
 *
 * Quando gli slot sono pieni si sostituisce la più vecchia. Nel gioco finito
 * questa sarà una scelta del giocatore; qui la regola automatica è dichiarata
 * e prevedibile, che è meglio di non imparare nulla in silenzio.
 */
function mergeMoves(
  current: readonly string[],
  learned: readonly string[],
  maxSlots = 4,
): string[] {
  const moves = [...current];
  for (const move of learned) {
    if (moves.includes(move)) continue;
    if (moves.length >= maxSlots) moves.shift();
    moves.push(move);
  }
  return moves;
}

export interface XpShare {
  /** Esperienza piena per chi ha combattuto. */
  readonly active: number;
  /** Esperienza ridotta per i compagni in panchina. */
  readonly bench: number;
}

export function splitXp(total: number, config: CreatureConfig): XpShare {
  return { active: total, bench: Math.floor(total * config.xp.partyShare) };
}

/** Progresso verso il livello successivo, 0..1, per la barra nella UI. */
export function levelProgress(
  creature: CreatureInstance,
  species: Species,
  config: CreatureConfig,
): number {
  if (creature.level >= config.maxLevel) return 1;
  const needed = xpToNextLevel(species, creature.level, config);
  if (needed <= 0) return 0;
  return Math.max(0, Math.min(1, creature.xp / needed));
}
