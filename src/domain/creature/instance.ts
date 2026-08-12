import type { Rng } from '../rng';
import { knownMoves, STAT_KEYS, type Species, type StatBlock, type StatusId } from './species';
import { computeStats, type CreatureConfig } from './stats';

/** Un esemplare posseduto o selvatico. È questo che finisce nel salvataggio. */
export interface CreatureInstance {
  readonly uid: string;
  readonly speciesId: string;
  readonly nickname?: string;
  readonly level: number;
  readonly xp: number;
  readonly ivs: StatBlock;
  readonly traits: readonly string[];
  /** HP correnti. Il massimo si ricalcola, questo no: è uno stato, non una statistica. */
  readonly hp: number;
  readonly status?: StatusId;
  readonly moves: readonly string[];
  readonly isAlpha: boolean;
  readonly morale: number;
  readonly caughtAt: number;
}

const UID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Identificatore univoco generato dal RNG seeded.
 *
 * Non si usa `crypto.randomUUID()` né nanoid: il dominio è puro, e un uid
 * derivato dallo stream rende riproducibile anche la generazione degli
 * esemplari, che è ciò che permette a `balance-sim` di confrontare due run.
 */
export function generateUid(rng: Rng, length = 12): string {
  let uid = '';
  for (let i = 0; i < length; i += 1) uid += rng.pick([...UID_ALPHABET]);
  return uid;
}

export function rollIvs(rng: Rng, config: CreatureConfig): StatBlock {
  const ivs = {} as Record<string, number>;
  for (const key of STAT_KEYS) ivs[key] = rng.int(0, config.stats.ivMax);
  return ivs as StatBlock;
}

/** Zero, uno o due tratti, secondo le probabilità in `creatures.json`. */
export function rollTraits(rng: Rng, config: CreatureConfig): string[] {
  const { none, one } = config.traitCount;
  const roll = rng.next();
  const wanted = roll < none ? 0 : roll < none + one ? 1 : 2;
  if (wanted === 0) return [];

  const pool = config.traits.map((trait) => trait.id);
  return rng.shuffle(pool).slice(0, Math.min(wanted, pool.length));
}

export interface CreateCreatureOptions {
  readonly species: Species;
  readonly level: number;
  readonly isAlpha: boolean;
  readonly caughtAt: number;
}

export function createCreature(
  options: CreateCreatureOptions,
  config: CreatureConfig,
  rng: Rng,
): CreatureInstance {
  const ivs = rollIvs(rng, config);
  const traits = rollTraits(rng, config);
  const stats = computeStats(
    { species: options.species, level: options.level, ivs, traits, isAlpha: options.isAlpha },
    config,
  );

  return {
    uid: generateUid(rng),
    speciesId: options.species.id,
    level: options.level,
    xp: 0,
    ivs,
    traits,
    hp: stats.hp,
    moves: knownMoves(options.species, options.level),
    isAlpha: options.isAlpha,
    morale: 100,
    caughtAt: options.caughtAt,
  };
}

export function maxHp(
  instance: CreatureInstance,
  species: Species,
  config: CreatureConfig,
): number {
  return computeStats(
    {
      species,
      level: instance.level,
      ivs: instance.ivs,
      traits: instance.traits,
      isAlpha: instance.isAlpha,
    },
    config,
  ).hp;
}

export function isFainted(instance: CreatureInstance): boolean {
  return instance.hp <= 0;
}

/**
 * Rimette in piedi tutta la squadra.
 *
 * PDR §5.6: dopo un KO ci si risveglia, non si perde la partita. Senza questa
 * regola una squadra a zero PV è un vicolo cieco — ogni scontro successivo
 * finirebbe perso in partenza, e l'unica via d'uscita sarebbe cancellare il
 * salvataggio.
 *
 * La perdita del 10% delle risorse trasportate arriverà con il Totem in Fase 4:
 * è la penalità, e ha senso solo quando esiste un posto dove risvegliarsi.
 */
export function healParty(
  party: readonly CreatureInstance[],
  species: ReadonlyMap<string, Species>,
  config: CreatureConfig,
): CreatureInstance[] {
  return party.map((member) => {
    const entry = species.get(member.speciesId);
    if (entry === undefined) return member;
    const { status: _scarta, ...rest } = member;
    return { ...rest, hp: maxHp(member, entry, config) };
  });
}
