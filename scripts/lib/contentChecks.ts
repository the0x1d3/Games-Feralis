/**
 * Schemi e integrità referenziale del contenuto di gioco: mosse, specie,
 * regole di combattimento, incontri.
 *
 * Sono i controlli che il gioco a runtime dà per scontati (ADR 0003). Un
 * `moveId` scritto male in un movepool non fa crashare nulla: produce un Ferale
 * con tre mosse invece di quattro, e nessuno se ne accorge finché non tocca a
 * lui in combattimento.
 */
import { z } from 'zod';

const ELEMENT_TYPES = ['neutro', 'flora', 'acqua', 'fuoco', 'fulmine', 'vento', 'terra'] as const;
const WORK_KINDS = ['gathering', 'mining', 'farming', 'flame', 'water', 'crafting'] as const;
const RARITIES = ['common', 'uncommon', 'rare', 'alpha'] as const;
const STATUS_IDS = ['burned', 'wet', 'paralyzed', 'rooted', 'stunned'] as const;

const statBlock = z.object({
  hp: z.number().positive(),
  att: z.number().positive(),
  dif: z.number().positive(),
  vel: z.number().positive(),
  ele: z.number().positive(),
  res: z.number().positive(),
});

export const movesSchema = z.object({
  moves: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'id in snake_case'),
        nameKey: z.string().min(1),
        type: z.enum(ELEMENT_TYPES),
        category: z.enum(['physical', 'elemental']),
        power: z.number().positive(),
        accuracy: z.number().min(0.1).max(1),
        inflicts: z
          .object({ status: z.enum(STATUS_IDS), chance: z.number().min(0).max(1) })
          .optional(),
      }),
    )
    .min(1),
});

export const speciesSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'id in snake_case'),
  nameKey: z.string().min(1),
  types: z.array(z.enum(ELEMENT_TYPES)).min(1).max(2),
  baseStats: statBlock,
  growthCurve: z.enum(['fast', 'medium', 'slow']),
  // Chiavi libere e non `z.enum`: in Zod 4 un record con chiavi enumerate le
  // pretende TUTTE, mentre una specie dichiara solo le mansioni che sa fare.
  // I nomi vengono verificati in `checkContent`.
  work: z.record(z.string(), z.number().int().min(0).max(3)),
  movepool: z
    .array(z.object({ moveId: z.string().min(1), level: z.number().int().positive() }))
    .min(1),
  baseCatchRate: z.number().min(0).max(1),
  rarity: z.enum(RARITIES),
  spawn: z
    .array(
      z.object({
        biome: z.string().min(1),
        timeOfDay: z.enum(['any', 'day', 'night']),
        weight: z.number().positive(),
      }),
    )
    .min(1),
  size: z.enum(['S', 'M', 'L']),
  sprite: z.object({
    atlas: z.string().min(1),
    key: z.string().min(1),
    frame: z.number().int().min(0),
  }),
});

export const creaturesSchema = z.object({
  maxLevel: z.number().int().positive(),
  stats: z.object({
    levelScaleDivisor: z.number().positive(),
    ivMax: z.number().int().positive(),
    ivScaleDivisor: z.number().positive(),
    hpLevelBonus: z.number().min(0),
    hpFlatBonus: z.number().min(0),
  }),
  rarity: z.record(z.enum(RARITIES), z.object({ baseCatchRate: z.number().min(0).max(1) })),
  alpha: z.object({ statMultiplier: z.number().positive() }),
  traitCount: z.object({
    none: z.number().min(0).max(1),
    one: z.number().min(0).max(1),
    two: z.number().min(0).max(1),
  }),
  traits: z
    .array(
      z.object({
        id: z.string().min(1),
        nameKey: z.string().min(1),
        stats: z.record(z.string(), z.number()),
      }),
    )
    .min(1),
});

export const battleSchema = z.object({
  party: z.object({ size: z.number().int().positive() }),
  atb: z.object({ threshold: z.number().positive(), tickScale: z.number().positive() }),
  damage: z.object({
    levelScaleDivisor: z.number().positive(),
    baseMultiplier: z.number().positive(),
    critMultiplier: z.number().min(1),
    baseCritChance: z.number().min(0).max(1),
    initiativeMultiplier: z.number().min(1),
    varianceMin: z.number().positive(),
    varianceMax: z.number().positive(),
  }),
  types: z.object({
    advantage: z.number().min(1),
    disadvantage: z.number().min(0).max(1),
    beats: z.record(z.string(), z.enum(ELEMENT_TYPES)),
  }),
  statuses: z.record(z.string(), z.object({ minTurns: z.number().int().positive() })),
  capture: z.object({
    hpFactorWeight: z.number().min(0).max(1),
    statusMultiplier: z.number().min(1),
    wetMultiplier: z.number().min(1),
    levelDeltaScale: z.number().min(0),
    levelDeltaMin: z.number().min(0),
    levelDeltaMax: z.number().min(0),
    minChance: z.number().min(0).max(1),
    maxChance: z.number().min(0).max(1),
    shakes: z.number().int().positive(),
  }),
  tools: z
    .array(
      z.object({
        id: z.string().min(1),
        nameKey: z.string().min(1),
        multiplier: z.number().positive(),
        nightOnly: z.boolean().optional(),
      }),
    )
    .min(1),
  flee: z.object({
    baseChance: z.number().min(0).max(1),
    speedScale: z.number().min(0),
    maxChance: z.number().min(0).max(1),
  }),
});

export const encountersSchema = z.object({
  chancePerStep: z.number().min(0).max(1),
  stepDistancePx: z.number().positive(),
  alphaChance: z.number().min(0).max(1),
  levelByBiome: z.record(
    z.string(),
    z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
  ),
});

export type ParsedSpecies = z.infer<typeof speciesSchema>;
export type ParsedMoves = z.infer<typeof movesSchema>;
export type ParsedBattle = z.infer<typeof battleSchema>;
export type ParsedCreatures = z.infer<typeof creaturesSchema>;
export type ParsedEncounters = z.infer<typeof encountersSchema>;

export interface ContentCheckInput {
  readonly species: ReadonlyMap<string, ParsedSpecies>;
  readonly moves: ParsedMoves;
  readonly battle: ParsedBattle;
  readonly creatures: ParsedCreatures;
  readonly encounters: ParsedEncounters;
  readonly translationKeys: ReadonlySet<string>;
  readonly knownZones: ReadonlySet<string>;
}

/**
 * I due triangoli devono essere chiusi: ogni tipo elementale batte esattamente
 * un tipo ed è battuto esattamente da uno. Un triangolo aperto crea un tipo
 * dominante, e con sei tipi soli non c'è modo di compensarlo altrove.
 */
function checkTypeTriangles(battle: ParsedBattle): string[] {
  const errors: string[] = [];
  const beats = battle.types.beats;
  const elemental = ELEMENT_TYPES.filter((type) => type !== 'neutro');

  for (const type of elemental) {
    if (beats[type] === undefined) {
      errors.push(`battle.json: il tipo "${type}" non batte niente`);
      continue;
    }
    if (beats[type] === type) errors.push(`battle.json: "${type}" batte se stesso`);

    const beatenBy = elemental.filter((other) => beats[other] === type);
    if (beatenBy.length !== 1) {
      errors.push(
        `battle.json: "${type}" è battuto da ${beatenBy.length} tipi invece che da uno solo`,
      );
    }
  }

  if (beats['neutro'] !== undefined) {
    errors.push('battle.json: il Neutro non deve battere nessuno (PDR §5.1)');
  }

  return errors;
}

export function checkContent(input: ContentCheckInput): string[] {
  const errors: string[] = [];
  const key = (value: string, where: string): void => {
    if (!input.translationKeys.has(value)) {
      errors.push(`${where}: la chiave i18n "${value}" non esiste`);
    }
  };

  const moveIds = new Set(input.moves.moves.map((move) => move.id));
  for (const move of input.moves.moves) key(move.nameKey, `moves.json/${move.id}`);
  for (const trait of input.creatures.traits) key(trait.nameKey, `creatures.json/${trait.id}`);
  for (const tool of input.battle.tools) key(tool.nameKey, `battle.json/${tool.id}`);

  errors.push(...checkTypeTriangles(input.battle));

  const traitCount = input.creatures.traitCount;
  const sum = traitCount.none + traitCount.one + traitCount.two;
  if (Math.abs(sum - 1) > 1e-6) {
    errors.push(`creatures.json: le probabilità dei tratti sommano a ${sum} invece che a 1`);
  }

  const frames = new Map<number, string>();

  for (const id of STATUS_IDS) {
    if (input.battle.statuses[id] === undefined) {
      errors.push(`battle.json: manca la definizione dello stato "${id}"`);
    }
  }

  for (const [id, entry] of input.species) {
    key(entry.nameKey, `species/${id}`);

    for (const work of Object.keys(entry.work)) {
      if (!(WORK_KINDS as readonly string[]).includes(work)) {
        errors.push(`species/${id}: la mansione "${work}" non esiste`);
      }
    }

    for (const slot of entry.movepool) {
      if (!moveIds.has(slot.moveId)) {
        errors.push(`species/${id}: la mossa "${slot.moveId}" non esiste in moves.json`);
      }
    }
    if (entry.movepool.every((slot) => slot.level > 1)) {
      errors.push(`species/${id}: nessuna mossa disponibile al livello 1`);
    }

    const expected = input.creatures.rarity[entry.rarity]?.baseCatchRate;
    if (expected !== undefined && Math.abs(entry.baseCatchRate - expected) > 1e-6) {
      errors.push(
        `species/${id}: baseCatchRate ${entry.baseCatchRate}, ma la rarità "${entry.rarity}" ne dichiara ${expected}`,
      );
    }

    for (const spawn of entry.spawn) {
      if (!input.knownZones.has(spawn.biome)) {
        errors.push(`species/${id}: compare nel bioma "${spawn.biome}", che non ha una mappa`);
      }
    }

    const taken = frames.get(entry.sprite.frame);
    if (taken !== undefined) {
      errors.push(`species/${id}: usa il fotogramma ${entry.sprite.frame}, già preso da ${taken}`);
    }
    frames.set(entry.sprite.frame, id);
  }

  for (const biome of input.knownZones) {
    if (input.encounters.levelByBiome[biome] === undefined) {
      errors.push(`encounters.json: manca l'intervallo di livelli per il bioma "${biome}"`);
    }
  }

  return errors;
}
