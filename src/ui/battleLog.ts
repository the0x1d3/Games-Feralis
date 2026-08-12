import type { BattleEvent, Side } from '@domain/battle/state';
import { effectivenessOf } from '@domain/battle/typechart';
import type { Move, Species } from '@domain/creature/species';
import type { ItemDef } from '@domain/economy/items';
import { t, type TranslationKey } from '@i18n/index';

/**
 * Eventi di combattimento verso testo leggibile.
 *
 * Il registro non è decorazione: è il modo in cui il giocatore capisce perché
 * un colpo ha fatto poco danno, e quindi come funzionano i due triangoli dei
 * tipi. Per lo stesso motivo l'efficacia è scritta a parole e non affidata a
 * un colore (PDR §7.2).
 */

export interface LogNaming {
  speciesOf(side: Side): Species | undefined;
  moveById(moveId: string): Move | undefined;
  itemById(itemId: string): ItemDef | undefined;
  /** Nome del Ferale nello slot indicato della squadra. */
  partyNameAt(index: number): string | undefined;
}

/** Le chiavi che arrivano dai file di `/data` sono validate in CI (ADR 0003). */
function fromData(key: string): TranslationKey {
  return key as TranslationKey;
}

function nameOf(naming: LogNaming, side: Side): string {
  const species = naming.speciesOf(side);
  return species === undefined ? '?' : t(fromData(species.nameKey));
}

export function formatEvent(event: BattleEvent, naming: LogNaming): string[] {
  switch (event.kind) {
    case 'move': {
      const name = nameOf(naming, event.side);
      const move = naming.moveById(event.moveId);
      const moveName = move === undefined ? event.moveId : t(fromData(move.nameKey));
      const lines = [t('battle.log.move', { name, move: moveName })];

      if (event.missed) {
        lines.push(t('battle.log.missed', { name }));
        return lines;
      }

      if (event.crit) lines.push(t('battle.log.crit'));

      const effect = effectivenessOf(event.effectiveness);
      if (effect === 'advantage') lines.push(t('battle.effect.super'));
      if (effect === 'disadvantage') lines.push(t('battle.effect.weak'));

      lines.push(
        t('battle.log.damage', {
          name: nameOf(naming, event.side === 'player' ? 'enemy' : 'player'),
          amount: event.damage,
        }),
      );
      return lines;
    }

    case 'statusApplied':
      return [
        t('battle.log.statusApplied', {
          name: nameOf(naming, event.side),
          status: t(fromData(`status.${event.statusId}`)),
        }),
      ];

    case 'statusDamage':
      return [
        t('battle.log.statusDamage', { name: nameOf(naming, event.side), amount: event.amount }),
      ];

    case 'statusEnded':
      return [t('battle.log.statusEnded', { name: nameOf(naming, event.side) })];

    case 'stunned':
      return [t('battle.log.stunned', { name: nameOf(naming, event.side) })];

    case 'faint':
      return [t('battle.log.faint', { name: nameOf(naming, event.side) })];

    case 'switch':
      return [t('battle.log.switch', { name: nameOf(naming, event.side) })];

    case 'switchBlocked':
      return [t('battle.log.switchBlocked')];

    case 'capture': {
      const name = nameOf(naming, 'enemy');
      const lines = [t('battle.log.capture', { chance: Math.round(event.chance * 100) })];
      lines.push(
        event.captured
          ? t('battle.log.captured', { name })
          : t('battle.log.captureFailed', { name }),
      );
      return lines;
    }

    case 'item': {
      if (!event.applied) return [t('battle.log.itemFailed')];
      const item = naming.itemById(event.itemId);
      return [
        t('battle.log.item', {
          name: item === undefined ? event.itemId : t(fromData(item.nameKey)),
          target: naming.partyNameAt(event.targetIndex) ?? '?',
        }),
      ];
    }

    case 'flee':
      return [event.success ? t('battle.log.fleeSuccess') : t('battle.log.fleeFailed')];

    case 'outcome':
      return [
        event.outcome === 'captured'
          ? t('battle.outcome.captured', { name: nameOf(naming, 'enemy') })
          : t(fromData(`battle.outcome.${event.outcome}`)),
      ];
  }
}
