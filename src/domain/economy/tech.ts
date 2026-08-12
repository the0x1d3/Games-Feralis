import { asArray, asNumber, asRecord, asString } from '../guards';

/**
 * L'albero tecnologico.
 *
 * Quattro tier, ognuno aperto da un numero di nodi del tier precedente. Il
 * gate del Custode (PDR §4.5) è previsto nel dato ma resta spento fino alla
 * Fase 6: i Custodi non esistono ancora, e una bandiera che nessuno può alzare
 * renderebbe il tier 3 irraggiungibile proprio mentre il criterio di
 * accettazione della Fase 5 chiede di arrivarci (errata E22).
 *
 * La regola che conta è l'ultima funzione del file: `unreachableNodes`. Un
 * albero con un ramo irraggiungibile è un vicolo cieco che il giocatore scopre
 * dopo ore, e `validate:data` lo intercetta in CI.
 */

export interface TechNode {
  readonly id: string;
  readonly nameKey: string;
  readonly tier: number;
  readonly cost: number;
  readonly requires: readonly string[];
}

export interface TechTier {
  readonly tier: number;
  /** Quanti nodi del tier precedente servono per aprire questo. */
  readonly requiresNodes: number;
  /** Bandiera del Custode. `undefined` finché i Custodi non esistono. */
  readonly guardianFlag?: string;
}

export interface TechConfig {
  readonly points: {
    readonly firstEncounter: number;
    readonly guardian: number;
    readonly objective: number;
  };
  readonly tiers: readonly TechTier[];
  readonly nodes: ReadonlyMap<string, TechNode>;
}

export type TechRefusal =
  | 'unknownNode'
  | 'alreadyUnlocked'
  | 'missingRequirement'
  | 'tierLocked'
  | 'guardianMissing'
  | 'notEnoughPoints';

export interface TechCheck {
  readonly ok: boolean;
  readonly refusal?: TechRefusal;
}

export function parseTech(raw: unknown): TechConfig {
  const root = asRecord(raw, 'tech.json');
  const points = asRecord(root['points'], 'tech.json.points');

  const tiers = asArray(root['tiers'], 'tech.json.tiers').map((entry, index) => {
    const record = asRecord(entry, `tech.json.tiers[${index}]`);
    const flag = record['guardianFlag'];
    return {
      tier: asNumber(record['tier'], `tech.json.tiers[${index}].tier`),
      requiresNodes: asNumber(
        record['requiresNodes'],
        `tech.json.tiers[${index}].requiresNodes`,
      ),
      ...(typeof flag === 'string' && flag.length > 0 ? { guardianFlag: flag } : {}),
    };
  });

  const nodes = new Map<string, TechNode>();
  for (const [index, entry] of asArray(root['nodes'], 'tech.json.nodes').entries()) {
    const record = asRecord(entry, `tech.json.nodes[${index}]`);
    const id = asString(record['id'], `tech.json.nodes[${index}].id`);
    nodes.set(id, {
      id,
      nameKey: asString(record['nameKey'], `${id}.nameKey`),
      tier: asNumber(record['tier'], `${id}.tier`),
      cost: asNumber(record['cost'], `${id}.cost`),
      requires: asArray(record['requires'], `${id}.requires`).map((value, position) =>
        asString(value, `${id}.requires[${position}]`),
      ),
    });
  }

  return {
    points: {
      firstEncounter: asNumber(points['firstEncounter'], 'tech.json.points.firstEncounter'),
      guardian: asNumber(points['guardian'], 'tech.json.points.guardian'),
      objective: asNumber(points['objective'], 'tech.json.points.objective'),
    },
    tiers,
    nodes,
  };
}

export function tierOf(config: TechConfig, tier: number): TechTier | undefined {
  return config.tiers.find((entry) => entry.tier === tier);
}

/** Quanti nodi di un tier sono già sbloccati. */
export function unlockedInTier(
  config: TechConfig,
  unlocked: readonly string[],
  tier: number,
): number {
  return unlocked.filter((id) => config.nodes.get(id)?.tier === tier).length;
}

export interface TechState {
  readonly unlocked: readonly string[];
  readonly points: number;
  readonly flags: Readonly<Record<string, boolean>>;
}

export function canUnlock(config: TechConfig, state: TechState, nodeId: string): TechCheck {
  const node = config.nodes.get(nodeId);
  if (node === undefined) return { ok: false, refusal: 'unknownNode' };
  if (state.unlocked.includes(nodeId)) return { ok: false, refusal: 'alreadyUnlocked' };

  for (const required of node.requires) {
    if (!state.unlocked.includes(required)) return { ok: false, refusal: 'missingRequirement' };
  }

  const tier = tierOf(config, node.tier);
  if (tier !== undefined) {
    if (unlockedInTier(config, state.unlocked, node.tier - 1) < tier.requiresNodes) {
      return { ok: false, refusal: 'tierLocked' };
    }
    if (tier.guardianFlag !== undefined && state.flags[tier.guardianFlag] !== true) {
      return { ok: false, refusal: 'guardianMissing' };
    }
  }

  if (state.points < node.cost) return { ok: false, refusal: 'notEnoughPoints' };

  return { ok: true };
}

/**
 * I nodi che nessuna sequenza di scelte può raggiungere.
 *
 * Simula il giocatore più diligente: sblocca tutto ciò che può, finché non
 * cambia più nulla. Quel che resta fuori è un vicolo cieco — un prerequisito
 * inesistente, un ciclo, un tier che nessuno può aprire, oppure semplicemente
 * più punti di quanti il gioco ne distribuisca.
 */
export function unreachableNodes(config: TechConfig, budget: number): string[] {
  const unlocked: string[] = [];
  const flags: Record<string, boolean> = {};
  // Le bandiere dei Custodi si danno per alzate: qui si misura la struttura
  // dell'albero, non l'ordine in cui si affrontano i capi.
  for (const tier of config.tiers) {
    if (tier.guardianFlag !== undefined) flags[tier.guardianFlag] = true;
  }

  let spent = 0;
  let progressed = true;

  while (progressed) {
    progressed = false;
    for (const node of config.nodes.values()) {
      const check = canUnlock(config, { unlocked, points: budget - spent, flags }, node.id);
      if (!check.ok) continue;
      unlocked.push(node.id);
      spent += node.cost;
      progressed = true;
    }
  }

  return [...config.nodes.keys()].filter((id) => !unlocked.includes(id));
}

/** Il costo totale dell'albero: serve a dire se il budget di punti basta. */
export function totalCost(config: TechConfig): number {
  return [...config.nodes.values()].reduce((sum, node) => sum + node.cost, 0);
}
