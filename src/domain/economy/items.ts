import type { CreatureInstance } from '../creature/instance';
import { asArray, asNumber, asRecord, asString } from '../guards';

/**
 * Oggetti consumabili.
 *
 * Tre effetti soli, e volutamente pochi: cura, guarigione da uno stato,
 * rianimazione. Il PDR §5.6 vieta la morte con perdita di oggetti, quindi gli
 * oggetti non sono una rete di sicurezza contro un errore fatale — sono un
 * modo di allungare una sessione. Con più effetti diventerebbero un sistema da
 * bilanciare, e non è quello che serve all'MVP.
 */

export type ItemKind = 'heal' | 'cure' | 'revive';

export interface ItemDef {
  readonly id: string;
  readonly nameKey: string;
  readonly kind: ItemKind;
  /** Punti vita restituiti, per `heal`. */
  readonly amount?: number;
  /** Frazione degli HP massimi restituita, per `revive`. */
  readonly fraction?: number;
  readonly usableInBattle: boolean;
}

const KINDS: readonly ItemKind[] = ['heal', 'cure', 'revive'];

export function parseItems(raw: unknown): Map<string, ItemDef> {
  const root = asRecord(raw, 'items.json');
  const items = new Map<string, ItemDef>();

  for (const [index, entry] of asArray(root['items'], 'items.json.items').entries()) {
    const record = asRecord(entry, `items.json.items[${index}]`);
    const id = asString(record['id'], `items.json.items[${index}].id`);
    const kind = asString(record['kind'], `${id}.kind`);
    if (!KINDS.includes(kind as ItemKind)) {
      throw new TypeError(`${id}.kind: "${kind}" non è fra ${KINDS.join(', ')}`);
    }

    const amount = record['amount'];
    const fraction = record['fraction'];

    items.set(id, {
      id,
      nameKey: asString(record['nameKey'], `${id}.nameKey`),
      kind: kind as ItemKind,
      ...(amount === undefined ? {} : { amount: asNumber(amount, `${id}.amount`) }),
      ...(fraction === undefined ? {} : { fraction: asNumber(fraction, `${id}.fraction`) }),
      usableInBattle: record['usableInBattle'] === true,
    });
  }

  return items;
}

export type ItemRefusal = 'alreadyFull' | 'notFainted' | 'noStatus' | 'fainted';

/** Il minimo che serve per decidere se un oggetto ha effetto. */
export interface ItemTarget {
  readonly hp: number;
  readonly maxHp: number;
  readonly hasStatus: boolean;
}

export interface ItemEffect {
  readonly applied: boolean;
  /** Nuovi punti vita, se l'oggetto li cambia. */
  readonly hp?: number;
  readonly clearStatus?: boolean;
  /** Perché non ha avuto effetto. La UI lo spiega invece di ingoiare il consumo. */
  readonly refusal?: ItemRefusal;
}

/**
 * Decide l'effetto di un oggetto.
 *
 * Lavora sulla forma minima e non su `CreatureInstance` perché serve a due
 * chiamanti con strutture diverse: la squadra fuori dal combattimento e il
 * contendente dentro. La regola sta scritta una volta sola.
 *
 * Se non ha effetto l'oggetto **non viene consumato**: sprecarlo per una
 * distrazione è il tipo di frustrazione che il PDR §5.4 chiede di evitare, e
 * qui costa una riga.
 */
export function resolveItemEffect(item: ItemDef, target: ItemTarget): ItemEffect {
  const fainted = target.hp <= 0;

  switch (item.kind) {
    case 'heal': {
      if (fainted) return { applied: false, refusal: 'fainted' };
      if (target.hp >= target.maxHp) return { applied: false, refusal: 'alreadyFull' };
      return { applied: true, hp: Math.min(target.maxHp, target.hp + (item.amount ?? 0)) };
    }

    case 'cure': {
      if (!target.hasStatus) return { applied: false, refusal: 'noStatus' };
      return { applied: true, clearStatus: true };
    }

    case 'revive': {
      if (!fainted) return { applied: false, refusal: 'notFainted' };
      return {
        applied: true,
        hp: Math.max(1, Math.round(target.maxHp * (item.fraction ?? 0.5))),
        clearStatus: true,
      };
    }
  }
}

export interface ItemUse {
  readonly creature: CreatureInstance;
  readonly applied: boolean;
  readonly refusal?: ItemRefusal;
}

/** Applica un oggetto a un esemplare della squadra. */
export function applyItem(item: ItemDef, creature: CreatureInstance, maxHp: number): ItemUse {
  const effect = resolveItemEffect(item, {
    hp: creature.hp,
    maxHp,
    hasStatus: creature.status !== undefined,
  });

  if (!effect.applied) {
    return {
      creature,
      applied: false,
      ...(effect.refusal === undefined ? {} : { refusal: effect.refusal }),
    };
  }

  const { status: _scarta, ...rest } = creature;
  const next: CreatureInstance =
    effect.clearStatus === true
      ? { ...rest, hp: effect.hp ?? creature.hp }
      : { ...creature, hp: effect.hp ?? creature.hp };

  return { creature: next, applied: true };
}
