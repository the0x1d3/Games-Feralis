import { asArray, asNumber, asRecord, asString } from '../guards';
import {
  RARITIES,
  STAT_KEYS,
  type Rarity,
  type Species,
  type StatBlock,
  type StatKey,
} from './species';

/**
 * Statistiche effettive di un esemplare.
 *
 * Il PDR §5.3 dichiarava `ivs: 0..31` senza dire come entrassero nel calcolo, e
 * non definiva affatto la crescita per livello: è il buco E7 dell'errata.
 *
 * La regola qui è: **le statistiche non si salvano mai**. Si ricalcolano ogni
 * volta da specie, livello, IV, tratti e stato Alfa. Un tratto che modifica gli
 * HP è un moltiplicatore applicato al momento, non un numero scritto nel
 * salvataggio — altrimenti ribilanciare un tratto richiederebbe una migrazione,
 * e due esemplari identici finirebbero per divergere.
 */

export interface TraitDef {
  readonly id: string;
  readonly nameKey: string;
  /** Frazioni: 0.12 = +12%. */
  readonly stats: Partial<Record<StatKey, number>>;
}

export interface XpConfig {
  readonly curve: Readonly<Record<'fast' | 'medium' | 'slow', number>>;
  readonly quadratic: number;
  readonly linear: number;
  readonly flat: number;
  /** Punti esperienza per livello dell'avversario sconfitto o catturato. */
  readonly fromDefeat: number;
  readonly alphaMultiplier: number;
  /** Frazione che ricevono i compagni che non erano in campo. */
  readonly partyShare: number;
}

export interface CreatureConfig {
  readonly maxLevel: number;
  readonly xp: XpConfig;
  readonly stats: {
    readonly levelScaleDivisor: number;
    readonly ivMax: number;
    readonly ivScaleDivisor: number;
    readonly hpLevelBonus: number;
    readonly hpFlatBonus: number;
  };
  readonly rarity: Readonly<Record<Rarity, { readonly baseCatchRate: number }>>;
  readonly alpha: { readonly statMultiplier: number };
  readonly traitCount: { readonly none: number; readonly one: number; readonly two: number };
  readonly traits: readonly TraitDef[];
}

export function parseCreatureConfig(raw: unknown): CreatureConfig {
  const root = asRecord(raw, 'creatures.json');
  const stats = asRecord(root['stats'], 'creatures.json.stats');
  const rarityRaw = asRecord(root['rarity'], 'creatures.json.rarity');
  const traitCount = asRecord(root['traitCount'], 'creatures.json.traitCount');

  const rarity = {} as Record<Rarity, { baseCatchRate: number }>;
  for (const key of RARITIES) {
    rarity[key] = {
      baseCatchRate: asNumber(
        asRecord(rarityRaw[key], `creatures.json.rarity.${key}`)['baseCatchRate'],
        `creatures.json.rarity.${key}.baseCatchRate`,
      ),
    };
  }

  const xp = asRecord(root['xp'], 'creatures.json.xp');
  const curveRaw = asRecord(xp['curve'], 'creatures.json.xp.curve');

  return {
    maxLevel: asNumber(root['maxLevel'], 'creatures.json.maxLevel'),
    xp: {
      curve: {
        fast: asNumber(curveRaw['fast'], 'creatures.json.xp.curve.fast'),
        medium: asNumber(curveRaw['medium'], 'creatures.json.xp.curve.medium'),
        slow: asNumber(curveRaw['slow'], 'creatures.json.xp.curve.slow'),
      },
      quadratic: asNumber(xp['quadratic'], 'creatures.json.xp.quadratic'),
      linear: asNumber(xp['linear'], 'creatures.json.xp.linear'),
      flat: asNumber(xp['flat'], 'creatures.json.xp.flat'),
      fromDefeat: asNumber(xp['fromDefeat'], 'creatures.json.xp.fromDefeat'),
      alphaMultiplier: asNumber(xp['alphaMultiplier'], 'creatures.json.xp.alphaMultiplier'),
      partyShare: asNumber(xp['partyShare'], 'creatures.json.xp.partyShare'),
    },
    stats: {
      levelScaleDivisor: asNumber(
        stats['levelScaleDivisor'],
        'creatures.json.stats.levelScaleDivisor',
      ),
      ivMax: asNumber(stats['ivMax'], 'creatures.json.stats.ivMax'),
      ivScaleDivisor: asNumber(stats['ivScaleDivisor'], 'creatures.json.stats.ivScaleDivisor'),
      hpLevelBonus: asNumber(stats['hpLevelBonus'], 'creatures.json.stats.hpLevelBonus'),
      hpFlatBonus: asNumber(stats['hpFlatBonus'], 'creatures.json.stats.hpFlatBonus'),
    },
    rarity,
    alpha: {
      statMultiplier: asNumber(
        asRecord(root['alpha'], 'creatures.json.alpha')['statMultiplier'],
        'creatures.json.alpha.statMultiplier',
      ),
    },
    traitCount: {
      none: asNumber(traitCount['none'], 'creatures.json.traitCount.none'),
      one: asNumber(traitCount['one'], 'creatures.json.traitCount.one'),
      two: asNumber(traitCount['two'], 'creatures.json.traitCount.two'),
    },
    traits: asArray(root['traits'], 'creatures.json.traits').map((entry, index) => {
      const trait = asRecord(entry, `creatures.json.traits[${index}]`);
      const id = asString(trait['id'], `creatures.json.traits[${index}].id`);
      const modifiers: Partial<Record<StatKey, number>> = {};
      for (const [key, value] of Object.entries(asRecord(trait['stats'], `${id}.stats`))) {
        if (!(STAT_KEYS as readonly string[]).includes(key)) {
          throw new TypeError(
            `creatures.json: il tratto "${id}" modifica "${key}", che non è una statistica`,
          );
        }
        modifiers[key as StatKey] = asNumber(value, `${id}.stats.${key}`);
      }
      return { id, nameKey: asString(trait['nameKey'], `${id}.nameKey`), stats: modifiers };
    }),
  };
}

export interface StatInput {
  readonly species: Species;
  readonly level: number;
  readonly ivs: StatBlock;
  readonly traits: readonly string[];
  readonly isAlpha: boolean;
}

/**
 * Somma delle modifiche dei tratti su una statistica. Si sommano invece di
 * moltiplicarsi: due tratti da +12% danno +24%, non +25.44%, e un giocatore
 * riesce a fare quel conto a mente.
 */
function traitModifier(config: CreatureConfig, traits: readonly string[], key: StatKey): number {
  let total = 0;
  for (const id of traits) {
    const trait = config.traits.find((entry) => entry.id === id);
    total += trait?.stats[key] ?? 0;
  }
  return total;
}

export function computeStats(input: StatInput, config: CreatureConfig): StatBlock {
  const { levelScaleDivisor, ivScaleDivisor, hpLevelBonus, hpFlatBonus } = config.stats;
  const levelScale = 1 + input.level / levelScaleDivisor;
  const alpha = input.isAlpha ? config.alpha.statMultiplier : 1;

  const result = {} as Record<StatKey, number>;

  for (const key of STAT_KEYS) {
    const base = input.species.baseStats[key];
    const ivScale = 1 + (input.ivs[key] ?? 0) / ivScaleDivisor;
    const traits = 1 + traitModifier(config, input.traits, key);
    const value = base * levelScale * ivScale * alpha * traits;

    result[key] =
      key === 'hp'
        ? Math.max(1, Math.floor(value) + input.level * hpLevelBonus + hpFlatBonus)
        : Math.max(1, Math.floor(value));
  }

  return result;
}

/**
 * Punti esperienza necessari per passare da `level` al successivo.
 *
 * La curva è quadratica: i primi livelli arrivano in fretta — è la Fase 1 del
 * gioco, dove serve che le cose succedano — e poi rallenta. I coefficienti
 * stanno in `creatures.json`, quindi rendere la progressione più lenta o più
 * rapida è modificare un JSON, non ricompilare.
 */
export function xpToNextLevel(species: Species, level: number, config: CreatureConfig): number {
  const { curve, quadratic, linear, flat } = config.xp;
  return Math.floor(
    curve[species.growthCurve] * (quadratic * level * level + linear * level + flat),
  );
}
