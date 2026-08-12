import type { WorkKind } from '../creature/species';
import { asArray, asNumber, asRecord, asString } from '../guards';

/** Lettura di `data/base.json` e `data/structures.json`. */

export type StructureKind = 'totem' | 'feeder' | 'producer';

export interface StructureDef {
  readonly id: string;
  readonly nameKey: string;
  readonly kind: StructureKind;
  /** Impronta in tile. */
  readonly width: number;
  readonly height: number;
  readonly cost: Readonly<Record<string, number>>;
  readonly frame: number;
  readonly work?: WorkKind;
  readonly minLevel?: number;
  readonly secondsPerOutput?: number;
  readonly input?: Readonly<Record<string, number>>;
  readonly output?: Readonly<Record<string, number>>;
}

export interface ResourceDef {
  readonly id: string;
  readonly nameKey: string;
}

export interface BaseConfig {
  readonly totemRadiusTiles: number;
  readonly production: {
    readonly workLevelBonus: number;
    readonly nightFactor: number;
    readonly moraleThresholds: { readonly full: number; readonly low: number };
    readonly moraleFactors: {
      readonly full: number;
      readonly low: number;
      readonly exhausted: number;
    };
  };
  readonly food: {
    readonly perWorkerPerHour: number;
    readonly moraleRecoverPerHour: number;
    readonly moraleDecayPerHour: number;
    readonly startingMorale: number;
  };
  /** Quanto costa un KO: una frazione dello zaino, mai il deposito (PDR §4.6). */
  readonly defeat: { readonly inventoryLossFraction: number };
  readonly offline: { readonly capMs: number; readonly maxSegments: number };
  readonly resources: readonly ResourceDef[];
}

function amounts(raw: unknown, what: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (raw === undefined) return result;
  for (const [id, value] of Object.entries(asRecord(raw, what))) {
    result[id] = asNumber(value, `${what}.${id}`);
  }
  return result;
}

export function parseBaseConfig(raw: unknown): BaseConfig {
  const root = asRecord(raw, 'base.json');
  const production = asRecord(root['production'], 'base.json.production');
  const thresholds = asRecord(production['moraleThresholds'], 'base.json.production.moraleThresholds');
  const factors = asRecord(production['moraleFactors'], 'base.json.production.moraleFactors');
  const food = asRecord(root['food'], 'base.json.food');
  const offline = asRecord(root['offline'], 'base.json.offline');

  return {
    totemRadiusTiles: asNumber(
      asRecord(root['totem'], 'base.json.totem')['radiusTiles'],
      'base.json.totem.radiusTiles',
    ),
    production: {
      workLevelBonus: asNumber(production['workLevelBonus'], 'base.json.production.workLevelBonus'),
      nightFactor: asNumber(production['nightFactor'], 'base.json.production.nightFactor'),
      moraleThresholds: {
        full: asNumber(thresholds['full'], 'base.json.production.moraleThresholds.full'),
        low: asNumber(thresholds['low'], 'base.json.production.moraleThresholds.low'),
      },
      moraleFactors: {
        full: asNumber(factors['full'], 'base.json.production.moraleFactors.full'),
        low: asNumber(factors['low'], 'base.json.production.moraleFactors.low'),
        exhausted: asNumber(factors['exhausted'], 'base.json.production.moraleFactors.exhausted'),
      },
    },
    food: {
      perWorkerPerHour: asNumber(food['perWorkerPerHour'], 'base.json.food.perWorkerPerHour'),
      moraleRecoverPerHour: asNumber(food['moraleRecoverPerHour'], 'base.json.food.moraleRecoverPerHour'),
      moraleDecayPerHour: asNumber(food['moraleDecayPerHour'], 'base.json.food.moraleDecayPerHour'),
      startingMorale: asNumber(food['startingMorale'], 'base.json.food.startingMorale'),
    },
    defeat: {
      inventoryLossFraction: asNumber(
        asRecord(root['defeat'], 'base.json.defeat')['inventoryLossFraction'],
        'base.json.defeat.inventoryLossFraction',
      ),
    },
    offline: {
      capMs: asNumber(offline['capMs'], 'base.json.offline.capMs'),
      maxSegments: asNumber(offline['maxSegments'], 'base.json.offline.maxSegments'),
    },
    resources: asArray(root['resources'], 'base.json.resources').map((entry, index) => {
      const record = asRecord(entry, `base.json.resources[${index}]`);
      return {
        id: asString(record['id'], `base.json.resources[${index}].id`),
        nameKey: asString(record['nameKey'], `base.json.resources[${index}].nameKey`),
      };
    }),
  };
}

const KINDS: readonly StructureKind[] = ['totem', 'feeder', 'producer'];

export function parseStructures(raw: unknown): Map<string, StructureDef> {
  const root = asRecord(raw, 'structures.json');
  const structures = new Map<string, StructureDef>();

  for (const [index, entry] of asArray(root['structures'], 'structures.json.structures').entries()) {
    const record = asRecord(entry, `structures.json.structures[${index}]`);
    const id = asString(record['id'], `structures.json.structures[${index}].id`);
    const kind = asString(record['kind'], `${id}.kind`);
    if (!KINDS.includes(kind as StructureKind)) {
      throw new TypeError(`${id}.kind: "${kind}" non è fra ${KINDS.join(', ')}`);
    }

    const work = record['work'];
    const minLevel = record['minLevel'];
    const seconds = record['secondsPerOutput'];

    structures.set(id, {
      id,
      nameKey: asString(record['nameKey'], `${id}.nameKey`),
      kind: kind as StructureKind,
      width: asNumber(record['width'], `${id}.width`),
      height: asNumber(record['height'], `${id}.height`),
      cost: amounts(record['cost'], `${id}.cost`),
      frame: asNumber(record['frame'], `${id}.frame`),
      ...(work === undefined ? {} : { work: asString(work, `${id}.work`) as WorkKind }),
      ...(minLevel === undefined ? {} : { minLevel: asNumber(minLevel, `${id}.minLevel`) }),
      ...(seconds === undefined ? {} : { secondsPerOutput: asNumber(seconds, `${id}.secondsPerOutput`) }),
      ...(record['input'] === undefined ? {} : { input: amounts(record['input'], `${id}.input`) }),
      ...(record['output'] === undefined ? {} : { output: amounts(record['output'], `${id}.output`) }),
    });
  }

  return structures;
}

/** Le strutture che il giocatore può costruire: il Totem si pianta a parte. */
export function buildableStructures(structures: ReadonlyMap<string, StructureDef>): StructureDef[] {
  return [...structures.values()].filter((structure) => structure.kind !== 'totem');
}

/**
 * Il Totem si cerca per `kind`, non per id.
 *
 * Gli id in `/data` sono immutabili (CLAUDE.md regola 5), ma scriverne uno nel
 * codice trasformerebbe un dato in una costante nascosta: il giorno che il
 * Totem si chiamasse diversamente in una nuova campagna, il gioco fallirebbe in
 * silenzio invece che alla validazione.
 */
export function totemStructure(
  structures: ReadonlyMap<string, StructureDef>,
): StructureDef | undefined {
  return [...structures.values()].find((structure) => structure.kind === 'totem');
}
