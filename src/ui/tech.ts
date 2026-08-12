import { canUnlock, tierOf, unlockedInTier, type TechNode } from '@domain/economy/tech';
import { onLocaleChange, t, type TranslationKey } from '@i18n/index';
import type { GameState } from '@state/gameState';
import type { GameContent } from '@state/loadContent';
import type { GameAction } from '@state/store';
import { element, ghostButton, text } from './widgets';

/**
 * L'albero delle tecnologie.
 *
 * Una lista per tier, non un grafo disegnato: con 28 nodi un grafo vero
 * costerebbe un layout, uno zoom e un pan, e direbbe la stessa cosa. Quel che
 * serve al giocatore è sapere cosa può sbloccare adesso e, quando non può,
 * **perché** — e il perché lo decide `domain/economy/tech.ts`, non questo file.
 */

export interface TechUiDeps {
  readonly getState: () => GameState;
  readonly content: GameContent;
  readonly dispatch: (action: GameAction) => void;
  readonly onOpen?: () => void;
}

export interface TechUi {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  refresh(): void;
  destroy(): void;
}

function fromData(key: string): TranslationKey {
  return key as TranslationKey;
}

export function mountTech(root: HTMLElement, deps: TechUiDeps): TechUi {
  const panel = element('section', 'tech');
  panel.hidden = true;

  const heading = element('h2', 'tech__title');
  const points = element('p', 'tech__points');
  const list = element('div', 'tech__list');
  const hint = element('p', 'tech__hint');
  const closeButton = ghostButton('', () => {
    close();
  });
  closeButton.classList.add('tech__close');

  panel.append(heading, points, list, hint, closeButton);
  root.append(panel);

  let opener: HTMLElement | undefined;

  function renderNode(node: TechNode): HTMLElement {
    const state = deps.getState();
    const row = element('article', 'tech__row');
    const done = state.tech.includes(node.id);

    row.append(text('h4', 'tech__name', t(fromData(node.nameKey))));

    if (node.requires.length > 0) {
      const names = node.requires
        .map((id) => deps.content.tech.nodes.get(id))
        .map((entry) => (entry === undefined ? '?' : t(fromData(entry.nameKey))))
        .join(', ');
      row.append(text('p', 'tech__meta', t('tech.requires', { what: names })));
    }

    if (done) {
      row.classList.add('tech__row--done');
      row.append(text('p', 'tech__meta', t('tech.unlocked')));
      return row;
    }

    const check = canUnlock(
      deps.content.tech,
      { unlocked: state.tech, points: state.techPoints, flags: state.flags },
      node.id,
    );

    row.append(
      ghostButton(
        t('tech.unlock', { cost: node.cost }),
        () => {
          deps.dispatch({ type: 'unlockTech', nodeId: node.id });
          render();
        },
        !check.ok,
      ),
    );

    // Un pulsante spento senza motivo è un vicolo cieco: qui il motivo si legge.
    if (!check.ok && check.refusal !== undefined && check.refusal !== 'alreadyUnlocked') {
      row.append(text('p', 'tech__meta', t(fromData(`tech.refusal.${check.refusal}`))));
    }

    return row;
  }

  function render(): void {
    const state = deps.getState();
    heading.textContent = t('tech.title');
    points.textContent = t('tech.points', { points: state.techPoints });
    hint.textContent = t('tech.hint');
    closeButton.textContent = t('tech.close');
    list.replaceChildren();

    for (const tier of deps.content.tech.tiers) {
      const group = element('div', 'tech__tier');
      const done = unlockedInTier(deps.content.tech, state.tech, tier.tier);
      const required = tierOf(deps.content.tech, tier.tier)?.requiresNodes ?? 0;
      const previous = unlockedInTier(deps.content.tech, state.tech, tier.tier - 1);

      const title = text('h3', 'tech__tierName', t('tech.tier', { tier: tier.tier }));
      if (previous < required) group.classList.add('tech__tier--locked');
      group.append(title);

      const nodes = [...deps.content.tech.nodes.values()].filter(
        (node) => node.tier === tier.tier,
      );
      for (const node of nodes) group.append(renderNode(node));

      const count = text('p', 'tech__meta', `${done}/${nodes.length}`);
      group.append(count);
      list.append(group);
    }
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
    if (event.key === 'Escape' && !panel.hidden) {
      close();
      return;
    }
    if (event.key === 't' || event.key === 'T') {
      if (panel.hidden) open();
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
    destroy(): void {
      unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
      panel.remove();
    },
  };
}
