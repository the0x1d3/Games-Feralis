import { asArray, asNumber, asRecord, asString } from '../guards';
import { ELEMENT_TYPES, type ElementType, type StatusId } from '../creature/species';

/** Lettura di `data/battle.json`. Ogni numero di bilanciamento arriva da lì. */

export const STATUS_IDS = ['burned', 'wet', 'paralyzed', 'rooted', 'stunned'] as const;

export interface StatusDef {
  readonly id: StatusId;
  readonly minTurns: number;
  readonly maxTurns: number;
  /** Frazione degli HP massimi persa a ogni turno. */
  readonly damagePerTurn?: number;
  readonly attMultiplier?: number;
  readonly velMultiplier?: number;
  /** Riduce la resistenza contro un tipo specifico (Bagnato → Fulmine, errata E3). */
  readonly resMultiplierAgainst?: Partial<Record<ElementType, number>>;
  readonly preventsSwitch?: boolean;
  readonly skipsTurn?: boolean;
}

export interface CaptureTool {
  readonly id: string;
  readonly nameKey: string;
  readonly multiplier: number;
  readonly nightOnly: boolean;
}

export interface BattleConfig {
  readonly partySize: number;
  readonly atb: { readonly threshold: number; readonly tickScale: number };
  readonly damage: {
    readonly levelScaleDivisor: number;
    readonly baseMultiplier: number;
    readonly critMultiplier: number;
    readonly baseCritChance: number;
    readonly initiativeMultiplier: number;
    readonly varianceMin: number;
    readonly varianceMax: number;
  };
  readonly types: {
    readonly advantage: number;
    readonly disadvantage: number;
    /** `beats[a] === b` significa "a è forte contro b". */
    readonly beats: Readonly<Partial<Record<ElementType, ElementType>>>;
  };
  readonly statuses: Readonly<Record<StatusId, StatusDef>>;
  readonly capture: {
    readonly hpFactorWeight: number;
    readonly statusMultiplier: number;
    readonly wetMultiplier: number;
    readonly levelDeltaScale: number;
    readonly levelDeltaMin: number;
    readonly levelDeltaMax: number;
    readonly minChance: number;
    readonly maxChance: number;
    readonly shakes: number;
  };
  readonly tools: readonly CaptureTool[];
  readonly flee: {
    readonly baseChance: number;
    readonly speedScale: number;
    readonly maxChance: number;
  };
}

function asElementType(value: string, what: string): ElementType {
  if (!(ELEMENT_TYPES as readonly string[]).includes(value)) {
    throw new TypeError(`${what}: "${value}" non è un tipo elementale`);
  }
  return value as ElementType;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  what: string,
): number | undefined {
  return record[key] === undefined ? undefined : asNumber(record[key], `${what}.${key}`);
}

function parseStatus(raw: unknown, id: StatusId): StatusDef {
  const record = asRecord(raw, `battle.json.statuses.${id}`);
  const what = `battle.json.statuses.${id}`;

  const resRaw = record['resMultiplierAgainst'];
  const resMultiplierAgainst: Partial<Record<ElementType, number>> = {};
  if (resRaw !== undefined) {
    for (const [key, value] of Object.entries(asRecord(resRaw, `${what}.resMultiplierAgainst`))) {
      resMultiplierAgainst[asElementType(key, `${what}.resMultiplierAgainst`)] = asNumber(
        value,
        `${what}.resMultiplierAgainst.${key}`,
      );
    }
  }

  const damagePerTurn = optionalNumber(record, 'damagePerTurn', what);
  const attMultiplier = optionalNumber(record, 'attMultiplier', what);
  const velMultiplier = optionalNumber(record, 'velMultiplier', what);

  return {
    id,
    minTurns: asNumber(record['minTurns'], `${what}.minTurns`),
    maxTurns: asNumber(record['maxTurns'], `${what}.maxTurns`),
    ...(damagePerTurn === undefined ? {} : { damagePerTurn }),
    ...(attMultiplier === undefined ? {} : { attMultiplier }),
    ...(velMultiplier === undefined ? {} : { velMultiplier }),
    ...(resRaw === undefined ? {} : { resMultiplierAgainst }),
    ...(record['preventsSwitch'] === true ? { preventsSwitch: true } : {}),
    ...(record['skipsTurn'] === true ? { skipsTurn: true } : {}),
  };
}

export function parseBattleConfig(raw: unknown): BattleConfig {
  const root = asRecord(raw, 'battle.json');
  const atb = asRecord(root['atb'], 'battle.json.atb');
  const damage = asRecord(root['damage'], 'battle.json.damage');
  const types = asRecord(root['types'], 'battle.json.types');
  const capture = asRecord(root['capture'], 'battle.json.capture');
  const flee = asRecord(root['flee'], 'battle.json.flee');
  const statusesRaw = asRecord(root['statuses'], 'battle.json.statuses');

  const beats: Partial<Record<ElementType, ElementType>> = {};
  for (const [from, to] of Object.entries(asRecord(types['beats'], 'battle.json.types.beats'))) {
    beats[asElementType(from, 'battle.json.types.beats')] = asElementType(
      asString(to, `battle.json.types.beats.${from}`),
      `battle.json.types.beats.${from}`,
    );
  }

  const statuses = {} as Record<StatusId, StatusDef>;
  for (const id of STATUS_IDS) statuses[id] = parseStatus(statusesRaw[id], id);

  return {
    partySize: asNumber(
      asRecord(root['party'], 'battle.json.party')['size'],
      'battle.json.party.size',
    ),
    atb: {
      threshold: asNumber(atb['threshold'], 'battle.json.atb.threshold'),
      tickScale: asNumber(atb['tickScale'], 'battle.json.atb.tickScale'),
    },
    damage: {
      levelScaleDivisor: asNumber(
        damage['levelScaleDivisor'],
        'battle.json.damage.levelScaleDivisor',
      ),
      baseMultiplier: asNumber(damage['baseMultiplier'], 'battle.json.damage.baseMultiplier'),
      critMultiplier: asNumber(damage['critMultiplier'], 'battle.json.damage.critMultiplier'),
      baseCritChance: asNumber(damage['baseCritChance'], 'battle.json.damage.baseCritChance'),
      initiativeMultiplier: asNumber(
        damage['initiativeMultiplier'],
        'battle.json.damage.initiativeMultiplier',
      ),
      varianceMin: asNumber(damage['varianceMin'], 'battle.json.damage.varianceMin'),
      varianceMax: asNumber(damage['varianceMax'], 'battle.json.damage.varianceMax'),
    },
    types: {
      advantage: asNumber(types['advantage'], 'battle.json.types.advantage'),
      disadvantage: asNumber(types['disadvantage'], 'battle.json.types.disadvantage'),
      beats,
    },
    statuses,
    capture: {
      hpFactorWeight: asNumber(capture['hpFactorWeight'], 'battle.json.capture.hpFactorWeight'),
      statusMultiplier: asNumber(
        capture['statusMultiplier'],
        'battle.json.capture.statusMultiplier',
      ),
      wetMultiplier: asNumber(capture['wetMultiplier'], 'battle.json.capture.wetMultiplier'),
      levelDeltaScale: asNumber(capture['levelDeltaScale'], 'battle.json.capture.levelDeltaScale'),
      levelDeltaMin: asNumber(capture['levelDeltaMin'], 'battle.json.capture.levelDeltaMin'),
      levelDeltaMax: asNumber(capture['levelDeltaMax'], 'battle.json.capture.levelDeltaMax'),
      minChance: asNumber(capture['minChance'], 'battle.json.capture.minChance'),
      maxChance: asNumber(capture['maxChance'], 'battle.json.capture.maxChance'),
      shakes: asNumber(capture['shakes'], 'battle.json.capture.shakes'),
    },
    tools: asArray(root['tools'], 'battle.json.tools').map((entry, index) => {
      const tool = asRecord(entry, `battle.json.tools[${index}]`);
      const id = asString(tool['id'], `battle.json.tools[${index}].id`);
      return {
        id,
        nameKey: asString(tool['nameKey'], `${id}.nameKey`),
        multiplier: asNumber(tool['multiplier'], `${id}.multiplier`),
        nightOnly: tool['nightOnly'] === true,
      };
    }),
    flee: {
      baseChance: asNumber(flee['baseChance'], 'battle.json.flee.baseChance'),
      speedScale: asNumber(flee['speedScale'], 'battle.json.flee.speedScale'),
      maxChance: asNumber(flee['maxChance'], 'battle.json.flee.maxChance'),
    },
  };
}
