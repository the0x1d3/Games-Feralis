import type { StructureDef } from '@domain/base/config';
import { canPlace } from '@domain/base/layout';
import type { Zone } from '@domain/world/zone';
import { t, type TranslationKey } from '@i18n/index';
import type { GameState } from '@state/gameState';
import type { GameContent } from '@state/loadContent';
import type { GameAction } from '@state/store';
import { element } from './widgets';

/**
 * La modalità costruzione.
 *
 * Non si sceglie la casella da una lista: si prende la struttura in mano, la si
 * porta in giro come un fantasma e la si posa con il tasto interagisci. La
 * casella buona dipende dal terreno e dal raggio del Totem, e indovinarla da un
 * menu sarebbe un esercizio di frustrazione.
 *
 * Qui non vive nessuna regola: se una casella è valida lo decide
 * `domain/base/layout.ts`. Questo modulo traduce il suo verdetto in un colore e
 * in una frase.
 */

export interface BuildGhost {
  readonly def: StructureDef;
  readonly tx: number;
  readonly ty: number;
  readonly ok: boolean;
}

export interface BuildModeDeps {
  readonly getState: () => GameState;
  readonly content: GameContent;
  readonly zones: ReadonlyMap<string, Zone>;
  readonly dispatch: (action: GameAction) => void;
  /** Chiamata quando si prende in mano una struttura: il pannello si toglie. */
  readonly onStart: () => void;
}

export interface BuildMode {
  start(def: StructureDef): void;
  ghost(): BuildGhost | undefined;
  confirm(): void;
  cancel(): void;
  isActive(): boolean;
  destroy(): void;
}

function fromData(key: string): TranslationKey {
  return key as TranslationKey;
}

export function createBuildMode(root: HTMLElement, deps: BuildModeDeps): BuildMode {
  // Il suggerimento sta fuori dal pannello: la modalità costruzione lo chiude,
  // e un'istruzione che sparisce nel momento in cui serve non serve a nulla.
  const hint = element('p', 'radura__hint');
  hint.setAttribute('aria-live', 'polite');
  root.append(hint);

  let building: StructureDef | undefined;

  /** Il verdetto del dominio sulla casella sotto i piedi del giocatore. */
  function evaluate(): (BuildGhost & { refusal?: string }) | undefined {
    const def = building;
    if (def === undefined) return undefined;

    const state = deps.getState();
    const zone = deps.zones.get(state.player.zoneId);
    if (zone === undefined) return undefined;

    // L'impronta si ancora alla casella su cui sta il giocatore: è la sola
    // regola che si possa prevedere senza guardare un tutorial.
    const tx = Math.floor(state.player.x / zone.tileSize);
    const ty = Math.floor(state.player.y / zone.tileSize);

    const check = canPlace(def, tx, ty, {
      base: state.base,
      structures: deps.content.structures,
      config: deps.content.base,
      grid: zone.collision,
      zoneId: state.player.zoneId,
    });

    return { def, tx, ty, ok: check.ok, ...(check.refusal === undefined ? {} : { refusal: check.refusal }) };
  }

  function cancel(): void {
    building = undefined;
    hint.textContent = '';
  }

  return {
    start(def): void {
      building = def;
      hint.textContent = t('base.buildHint', { name: t(fromData(def.nameKey)) });
      deps.onStart();
    },

    ghost: () => evaluate(),

    confirm(): void {
      const target = evaluate();
      if (target === undefined) return;

      // Un rifiuto non annulla la costruzione: si dice perché e la struttura
      // resta in mano, così basta spostarsi di una casella e riprovare.
      if (!target.ok) {
        hint.textContent = t(fromData(`base.refusal.${target.refusal ?? 'blockedTerrain'}`));
        return;
      }

      if (target.def.kind === 'totem') {
        deps.dispatch({
          type: 'plantTotem',
          zoneId: deps.getState().player.zoneId,
          tx: target.tx,
          ty: target.ty,
        });
      } else {
        deps.dispatch({ type: 'build', structureId: target.def.id, tx: target.tx, ty: target.ty });
      }

      cancel();
    },

    cancel,
    isActive: () => building !== undefined,

    destroy(): void {
      hint.remove();
    },
  };
}
