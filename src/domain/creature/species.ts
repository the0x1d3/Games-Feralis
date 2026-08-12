import { asArray, asNumber, asRecord, asString } from '../guards';

/** Vocabolario del contenuto: specie, mosse, tipi, mansioni. */

export const ELEMENT_TYPES = [
  'neutro',
  'flora',
  'acqua',
  'fuoco',
  'fulmine',
  'vento',
  'terra',
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

export const WORK_KINDS = ['gathering', 'mining', 'farming', 'flame', 'water', 'crafting'] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

export const RARITIES = ['common', 'uncommon', 'rare', 'alpha'] as const;

export type Rarity = (typeof RARITIES)[number];

export const STAT_KEYS = ['hp', 'att', 'dif', 'vel', 'ele', 'res'] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type StatBlock = Record<StatKey, number>;

export type MoveCategory = 'physical' | 'elemental';

export type StatusId = 'burned' | 'wet' | 'paralyzed' | 'rooted' | 'stunned';

export interface Move {
  readonly id: string;
  readonly nameKey: string;
  readonly type: ElementType;
  readonly category: MoveCategory;
  readonly power: number;
  readonly accuracy: number;
  readonly inflicts?: { readonly status: StatusId; readonly chance: number };
}

export interface SpawnEntry {
  readonly biome: string;
  readonly timeOfDay: 'any' | 'day' | 'night';
  readonly weight: number;
}

export interface Species {
  readonly id: string;
  readonly nameKey: string;
  readonly types: readonly ElementType[];
  readonly baseStats: StatBlock;
  readonly growthCurve: 'fast' | 'medium' | 'slow';
  readonly work: Partial<Record<WorkKind, number>>;
  readonly movepool: ReadonlyArray<{ readonly moveId: string; readonly level: number }>;
  readonly baseCatchRate: number;
  readonly rarity: Rarity;
  readonly spawn: readonly SpawnEntry[];
  readonly size: 'S' | 'M' | 'L';
  readonly spriteFrame: number;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const text = asString(value, what);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new TypeError(`${what}: "${text}" non è fra ${allowed.join(', ')}`);
  }
  return text as T;
}

export function parseMoves(raw: unknown): Map<string, Move> {
  const record = asRecord(raw, 'moves.json');
  const moves = new Map<string, Move>();

  for (const [index, entry] of asArray(record['moves'], 'moves.json.moves').entries()) {
    const move = asRecord(entry, `moves.json.moves[${index}]`);
    const id = asString(move['id'], `moves.json.moves[${index}].id`);
    const inflicts = move['inflicts'];

    const parsed: Move = {
      id,
      nameKey: asString(move['nameKey'], `${id}.nameKey`),
      type: asEnum(move['type'], ELEMENT_TYPES, `${id}.type`),
      category: asEnum(move['category'], ['physical', 'elemental'] as const, `${id}.category`),
      power: asNumber(move['power'], `${id}.power`),
      accuracy: asNumber(move['accuracy'], `${id}.accuracy`),
      ...(inflicts === undefined
        ? {}
        : {
            inflicts: {
              status: asEnum(
                asRecord(inflicts, `${id}.inflicts`)['status'],
                ['burned', 'wet', 'paralyzed', 'rooted', 'stunned'] as const,
                `${id}.inflicts.status`,
              ),
              chance: asNumber(
                asRecord(inflicts, `${id}.inflicts`)['chance'],
                `${id}.inflicts.chance`,
              ),
            },
          }),
    };

    if (moves.has(id)) throw new Error(`moves.json: id duplicato "${id}"`);
    moves.set(id, parsed);
  }

  return moves;
}

function parseStatBlock(raw: unknown, what: string): StatBlock {
  const record = asRecord(raw, what);
  const stats = {} as Record<StatKey, number>;
  for (const key of STAT_KEYS) stats[key] = asNumber(record[key], `${what}.${key}`);
  return stats;
}

export function parseSpecies(raw: unknown, expectedId?: string): Species {
  const record = asRecord(raw, `specie "${expectedId ?? '?'}"`);
  const id = asString(record['id'], 'specie.id');

  if (expectedId !== undefined && id !== expectedId) {
    // Gli id sono immutabili e legano i salvataggi: un file che non combacia
    // con il proprio nome è quasi sempre un copia-incolla dimenticato.
    throw new Error(`specie: il file "${expectedId}.json" dichiara id "${id}"`);
  }

  const work: Partial<Record<WorkKind, number>> = {};
  for (const [key, value] of Object.entries(asRecord(record['work'], `${id}.work`))) {
    work[asEnum(key, WORK_KINDS, `${id}.work`)] = asNumber(value, `${id}.work.${key}`);
  }

  return {
    id,
    nameKey: asString(record['nameKey'], `${id}.nameKey`),
    types: asArray(record['types'], `${id}.types`).map((type, i) =>
      asEnum(type, ELEMENT_TYPES, `${id}.types[${i}]`),
    ),
    baseStats: parseStatBlock(record['baseStats'], `${id}.baseStats`),
    growthCurve: asEnum(
      record['growthCurve'],
      ['fast', 'medium', 'slow'] as const,
      `${id}.growthCurve`,
    ),
    work,
    movepool: asArray(record['movepool'], `${id}.movepool`).map((entry, i) => {
      const slot = asRecord(entry, `${id}.movepool[${i}]`);
      return {
        moveId: asString(slot['moveId'], `${id}.movepool[${i}].moveId`),
        level: asNumber(slot['level'], `${id}.movepool[${i}].level`),
      };
    }),
    baseCatchRate: asNumber(record['baseCatchRate'], `${id}.baseCatchRate`),
    rarity: asEnum(record['rarity'], RARITIES, `${id}.rarity`),
    spawn: asArray(record['spawn'], `${id}.spawn`).map((entry, i) => {
      const slot = asRecord(entry, `${id}.spawn[${i}]`);
      return {
        biome: asString(slot['biome'], `${id}.spawn[${i}].biome`),
        timeOfDay: asEnum(
          slot['timeOfDay'],
          ['any', 'day', 'night'] as const,
          `${id}.spawn[${i}].timeOfDay`,
        ),
        weight: asNumber(slot['weight'], `${id}.spawn[${i}].weight`),
      };
    }),
    size: asEnum(record['size'], ['S', 'M', 'L'] as const, `${id}.size`),
    spriteFrame: asNumber(
      asRecord(record['sprite'], `${id}.sprite`)['frame'],
      `${id}.sprite.frame`,
    ),
  };
}

/** Le mosse conosciute a un dato livello: le ultime quattro imparate. */
export function knownMoves(species: Species, level: number, maxSlots = 4): string[] {
  return species.movepool
    .filter((slot) => slot.level <= level)
    .slice(-maxSlots)
    .map((slot) => slot.moveId);
}
