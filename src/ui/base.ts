import { buildableStructures, totemStructure } from '@domain/base/config';
import type { OfflineResult } from '@domain/base/offline';
import { moraleBand } from '@domain/base/production';
import { canAfford } from '@domain/base/state';
import type { Zone } from '@domain/world/zone';
import { onLocaleChange, t, type TranslationKey } from '@i18n/index';
import type { GameState } from '@state/gameState';
import type { GameContent } from '@state/loadContent';
import type { GameAction } from '@state/store';
import { createBuildMode, type BuildGhost } from './buildMode';
import { amountList, renderStructureRow, type RowDeps } from './baseRows';
import { element, ghostButton, text } from './widgets';

/**
 * Il pannello della Radura.
 *
 * Mostra risorse, morale e strutture. Costruire non si fa da qui: si sceglie
 * una struttura, il pannello si toglie di mezzo e la si porta in giro come un
 * fantasma (`buildMode.ts`) finché non si preme il tasto interagisci. La
 * casella buona dipende dal terreno e dal raggio del Totem, e sceglierla da un
 * menu significherebbe indovinare.
 *
 * Le righe delle strutture vivono in `baseRows.ts`: qui resta il guscio, cioè
 * apertura, chiusura, tastiera e riepilogo del rientro.
 */

export interface BaseUiDeps {
  readonly getState: () => GameState;
  readonly content: GameContent;
  readonly zones: ReadonlyMap<string, Zone>;
  readonly dispatch: (action: GameAction) => void;
  /** Chiamata quando il pannello si apre: serve a chiudere quelli rivali. */
  readonly onOpen?: () => void;
}

export interface BaseUi {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  refresh(): void;
  /** La casella proposta dalla modalità costruzione, già validata. */
  ghost(): BuildGhost | undefined;
  confirmBuild(): void;
  cancelBuild(): void;
  /** Il riepilogo di quanto è stato prodotto mentre la scheda era chiusa. */
  showOffline(result: OfflineResult): void;
  destroy(): void;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

function fromData(key: string): TranslationKey {
  return key as TranslationKey;
}

export function mountBase(root: HTMLElement, deps: BaseUiDeps): BaseUi {
  const panel = element('section', 'radura');
  panel.hidden = true;

  const heading = element('h2', 'radura__title');
  // Il riepilogo del rientro vive fuori da `render()`: non deve sparire alla
  // prima assegnazione di un lavoratore.
  const away = element('div', 'radura__away');
  away.hidden = true;
  const summary = element('div', 'radura__summary');
  const list = element('div', 'radura__list');
  const closeButton = ghostButton('', () => {
    close();
  });
  closeButton.classList.add('radura__close');

  panel.append(heading, away, summary, list, closeButton);
  root.append(panel);

  let opener: HTMLElement | undefined;

  const rowDeps: RowDeps = {
    getState: deps.getState,
    content: deps.content,
    dispatch: deps.dispatch,
    onChanged: () => {
      render();
    },
  };

  const build = createBuildMode(root, {
    getState: deps.getState,
    content: deps.content,
    zones: deps.zones,
    dispatch: deps.dispatch,
    onStart: () => {
      close();
    },
  });

  /* ----------------------------------------------------------- disegno */

  function renderSummary(): void {
    const state = deps.getState();
    summary.replaceChildren();

    const morale = element('p', 'radura__morale');
    const band = moraleBand(state.base.morale, deps.content.base);
    morale.textContent = `${t('base.morale', { value: Math.round(state.base.morale) })} · ${t(
      fromData(`base.morale.${band}`),
    )}`;
    summary.append(morale);

    const resources = element('ul', 'radura__resources');
    for (const resource of deps.content.base.resources) {
      const amount = state.base.resources[resource.id] ?? 0;
      const row = element('li', 'radura__resource');
      row.textContent = `${t(fromData(resource.nameKey))} ${amount}`;
      resources.append(row);
    }
    summary.append(resources);
  }

  function renderBuildList(): void {
    const state = deps.getState();
    const title = element('h3', 'radura__name');
    title.textContent = t('base.buildTitle');
    list.append(title);

    for (const def of buildableStructures(deps.content.structures)) {
      const row = element('article', 'radura__row radura__row--build');
      const meta = element('p', 'radura__meta');
      meta.textContent = t('base.cost', { cost: amountList(def.cost) });

      row.append(
        ghostButton(
          t(fromData(def.nameKey)),
          () => {
            build.start(def);
          },
          !canAfford(state.base, def.cost),
        ),
        meta,
      );
      list.append(row);
    }
  }

  function render(): void {
    heading.textContent = t('base.title');
    closeButton.textContent = t('base.close');
    list.replaceChildren();

    const state = deps.getState();

    if (state.base.totem === undefined) {
      summary.replaceChildren();
      const intro = element('p', 'radura__meta');
      intro.textContent = t('base.noTotem');
      const totem = totemStructure(deps.content.structures);
      list.append(intro);
      if (totem !== undefined) {
        list.append(
          ghostButton(t('base.plantTotem'), () => {
            build.start(totem);
          }),
        );
      }
      return;
    }

    renderSummary();
    for (const placed of state.base.structures) list.append(renderStructureRow(placed, rowDeps));
    renderBuildList();
  }

  function open(): void {
    deps.onOpen?.();
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    panel.hidden = false;
    render();
    list.querySelector('button')?.focus();
  }

  function close(): void {
    panel.hidden = true;
    opener?.focus();
    opener = undefined;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return;

    if (event.key === 'Escape') {
      if (build.isActive()) build.cancel();
      else if (!panel.hidden) close();
      return;
    }
    if (event.key === 'b' || event.key === 'B') {
      if (build.isActive()) build.cancel();
      else if (panel.hidden) open();
      else close();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  const unsubscribe = onLocaleChange(() => {
    if (!panel.hidden) render();
  });

  return {
    toggle: () => {
      if (panel.hidden) open();
      else close();
    },
    close,
    isOpen: () => !panel.hidden,
    refresh: () => {
      if (!panel.hidden) render();
    },
    ghost: () => build.ghost(),
    confirmBuild: () => {
      build.confirm();
    },
    cancelBuild: () => {
      build.cancel();
    },

    showOffline(result): void {
      const produced = amountList(result.produced);
      away.replaceChildren(
        text('h3', 'radura__name', t('base.offline.title')),
        text(
          'p',
          'radura__meta',
          t('base.offline.duration', {
            hours: Math.floor(result.elapsedMs / MS_PER_HOUR),
            minutes: Math.floor((result.elapsedMs % MS_PER_HOUR) / MS_PER_MINUTE),
          }),
        ),
        text(
          'p',
          'radura__meta',
          produced === ''
            ? t('base.offline.nothing')
            : t('base.offline.produced', { what: produced }),
        ),
        ghostButton(t('base.offline.dismiss'), () => {
          away.hidden = true;
        }),
      );
      away.hidden = false;
      open();
    },

    destroy(): void {
      unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
      build.destroy();
      panel.remove();
    },
  };
}
