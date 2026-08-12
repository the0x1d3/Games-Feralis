import { maxHp, type CreatureInstance } from '@domain/creature/instance';
import { levelProgress } from '@domain/creature/xp';
import { canEvolve } from '@domain/creature/evolution';
import { onLocaleChange, t, type TranslationKey } from '@i18n/index';
import type { GameContent } from '@state/loadContent';
import type { GameState } from '@state/gameState';
import type { GameAction } from '@state/store';
import { bar, element, ghostButton as button } from './widgets';

/**
 * Squadra, deposito e archivio.
 *
 * Tutto è fatto di `<button>` in ordine di documento, quindi la navigazione da
 * tastiera funziona senza gestori speciali: è il criterio di accettazione della
 * Fase 3, e si ottiene usando gli elementi giusti invece di ricostruirli con
 * dei `div`. Il pannello sposta il fuoco al suo interno quando si apre e lo
 * restituisce a chi l'ha aperto quando si chiude.
 */

export interface RosterUiDeps {
  readonly getState: () => GameState;
  readonly content: GameContent;
  readonly dispatch: (action: GameAction) => void;
  /** Chiamata quando il pannello si apre: serve a chiudere quelli rivali. */
  readonly onOpen?: () => void;
}

export interface RosterUi {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  refresh(): void;
  destroy(): void;
}

type Tab = 'party' | 'storage' | 'archive';

function fromData(key: string): TranslationKey {
  return key as TranslationKey;
}

export function mountRoster(root: HTMLElement, deps: RosterUiDeps): RosterUi {
  const panel = element('section', 'roster');
  panel.hidden = true;

  const heading = element('h2', 'roster__title');
  const tabs = element('div', 'roster__tabs');
  tabs.setAttribute('role', 'tablist');
  const list = element('div', 'roster__list');
  const detail = element('div', 'roster__detail');
  const closeButton = button('', () => {
    close();
  });
  closeButton.className = 'button button--ghost roster__close';

  panel.append(heading, tabs, list, detail, closeButton);
  root.append(panel);

  let tab: Tab = 'party';
  let selected: string | undefined;
  let opener: HTMLElement | undefined;

  const speciesOf = (creature: CreatureInstance) => deps.content.species.get(creature.speciesId);

  function displayName(creature: CreatureInstance): string {
    if (creature.nickname !== undefined) return creature.nickname;
    const species = speciesOf(creature);
    return species === undefined ? creature.speciesId : t(fromData(species.nameKey));
  }

  function renderTabs(): void {
    tabs.replaceChildren();
    const entries: ReadonlyArray<[Tab, TranslationKey]> = [
      ['party', 'roster.tab.party'],
      ['storage', 'roster.tab.storage'],
      ['archive', 'roster.tab.archive'],
    ];
    for (const [id, key] of entries) {
      const node = button(t(key), () => {
        tab = id;
        selected = undefined;
        render();
      });
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(tab === id));
      tabs.append(node);
    }
  }

  function renderCreatureRow(creature: CreatureInstance): HTMLElement {
    const species = speciesOf(creature);
    const row = element('article', 'roster__row');

    const pick = button(displayName(creature), () => {
      selected = selected === creature.uid ? undefined : creature.uid;
      render();
    });
    pick.className = 'button button--ghost roster__pick';
    pick.setAttribute('aria-expanded', String(selected === creature.uid));

    const meta = element('p', 'roster__meta');
    const full =
      species === undefined ? creature.hp : maxHp(creature, species, deps.content.creatures);
    meta.textContent = `${t('roster.level', { level: creature.level })} · ${t('battle.hp')} ${creature.hp}/${full}`;

    row.append(pick, meta, bar('bar--hp', creature.hp / Math.max(1, full)));

    if (species !== undefined) {
      row.append(bar('bar--xp', levelProgress(creature, species, deps.content.creatures)));
      if (canEvolve(creature, species, deps.content.species)) {
        const ready = element('span', 'roster__evolving');
        ready.textContent = t('roster.evolutionReady');
        row.append(ready);
      }
    }

    if (selected === creature.uid) row.append(renderActions(creature));
    return row;
  }

  function renderActions(creature: CreatureInstance): HTMLElement {
    const state = deps.getState();
    const box = element('div', 'roster__actions');
    const inParty = state.party.some((entry) => entry.uid === creature.uid);
    const index = state.party.findIndex((entry) => entry.uid === creature.uid);

    if (inParty) {
      box.append(
        button(
          t('roster.toStorage'),
          () => {
            deps.dispatch({ type: 'moveToStorage', uid: creature.uid });
            render();
          },
          state.party.length <= 1,
        ),
        button(
          t('roster.moveUp'),
          () => {
            deps.dispatch({ type: 'swapParty', a: index, b: index - 1 });
            render();
          },
          index <= 0,
        ),
        button(
          t('roster.moveDown'),
          () => {
            deps.dispatch({ type: 'swapParty', a: index, b: index + 1 });
            render();
          },
          index < 0 || index >= state.party.length - 1,
        ),
      );
    } else {
      box.append(
        button(
          t('roster.toParty'),
          () => {
            deps.dispatch({ type: 'moveToParty', uid: creature.uid });
            render();
          },
          state.party.length >= deps.content.battle.partySize,
        ),
      );
    }

    for (const [itemId, count] of Object.entries(state.inventory)) {
      const item = deps.content.items.get(itemId);
      if (item === undefined || count <= 0) continue;
      box.append(
        button(t('roster.useItem', { name: t(fromData(item.nameKey)), count }), () => {
          deps.dispatch({ type: 'useItem', itemId, uid: creature.uid });
          render();
        }),
      );
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'roster__input';
    input.value = creature.nickname ?? '';
    input.maxLength = 16;
    input.setAttribute('aria-label', t('roster.rename'));

    const confirm = button(t('roster.rename'), () => {
      deps.dispatch({ type: 'renameCreature', uid: creature.uid, nickname: input.value });
      render();
    });

    const renameRow = element('div', 'roster__rename');
    renameRow.append(input, confirm);
    box.append(renameRow);

    return box;
  }

  function renderArchive(): void {
    const state = deps.getState();
    const entries = [...deps.content.species.values()].sort((a, b) => a.id.localeCompare(b.id));
    const seen = entries.filter((entry) => state.archive[entry.id]?.seen === true).length;

    const progress = element('p', 'roster__progress');
    progress.textContent = t('archive.progress', { seen, total: entries.length });
    list.append(progress);

    for (const entry of entries) {
      const record = state.archive[entry.id];
      const row = element('article', 'roster__row roster__row--archive');
      const name = element('p', 'roster__pick');
      // Una voce non ancora incontrata resta anonima: è il senso dell'archivio.
      name.textContent = record?.seen === true ? t(fromData(entry.nameKey)) : t('archive.unknown');

      const info = element('p', 'roster__meta');
      info.textContent =
        record?.seen === true
          ? t('archive.caught', { count: record.caught })
          : t('archive.notSeen');

      row.append(name, info);
      list.append(row);
    }
  }

  function render(): void {
    heading.textContent = t('roster.title');
    closeButton.textContent = t('roster.close');
    renderTabs();
    list.replaceChildren();
    detail.replaceChildren();

    if (tab === 'archive') {
      renderArchive();
      return;
    }

    const state = deps.getState();
    const creatures = tab === 'party' ? state.party : state.storage;

    if (creatures.length === 0) {
      const empty = element('p', 'roster__empty');
      empty.textContent = t('roster.empty');
      list.append(empty);
      return;
    }

    for (const creature of creatures) list.append(renderCreatureRow(creature));
  }

  function open(): void {
    // Due pannelli grandi aperti insieme non ci stanno nella schermata, e
    // nessuno dei due si legge: chi apre chiude l'altro.
    deps.onOpen?.();
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    panel.hidden = false;
    render();
    // Il fuoco entra nel pannello: chi naviga da tastiera non deve tabulare
    // attraverso mezza pagina per arrivarci.
    tabs.querySelector('button')?.focus();
  }

  function close(): void {
    panel.hidden = true;
    selected = undefined;
    opener?.focus();
    opener = undefined;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'Escape' && !panel.hidden) {
      close();
      return;
    }
    if (event.key === 's' || event.key === 'S') {
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
