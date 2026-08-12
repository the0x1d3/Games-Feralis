import { atbProgress } from '@domain/battle/atb';
import type { BattleAction } from '@domain/battle/battle';
import { captureBreakdown, isToolUsable } from '@domain/battle/capture';
import type { BattleCombatant, BattleContext, Side } from '@domain/battle/state';
import type { Species } from '@domain/creature/species';
import { onLocaleChange, t, type TranslationKey } from '@i18n/index';
import type { ActiveBattle } from '@state/battleController';
import type { GameState } from '@state/gameState';
import { formatEvent } from './battleLog';

/**
 * Interfaccia del combattimento, in DOM sopra il canvas (PDR §6.1).
 *
 * Tutto ciò che il giocatore deve leggere sta qui: barre con i numeri scritti,
 * probabilità di cattura visibile *prima* di lanciare, registro a parole.
 * Il canvas si limita ai due Ferali e allo sfondo.
 */

export interface BattleUiDeps {
  readonly getState: () => GameState;
  readonly context: () => BattleContext;
  readonly submit: (action: BattleAction) => void;
  readonly end: () => void;
}

export interface BattleUi {
  render(active: ActiveBattle | undefined): void;
  destroy(): void;
}

type Menu = 'root' | 'moves' | 'party' | 'tools' | 'items';

const LOG_LINES = 6;

function fromData(key: string): TranslationKey {
  return key as TranslationKey;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'button button--ghost battle__button';
  node.textContent = label;
  node.disabled = disabled;
  node.addEventListener('click', onClick);
  return node;
}

export function mountBattleUi(root: HTMLElement, deps: BattleUiDeps): BattleUi {
  const panel = element('section', 'battle');
  panel.hidden = true;
  panel.setAttribute('aria-live', 'polite');

  const field = element('div', 'battle__field');
  const logList = element('ol', 'battle__log');
  const actions = element('div', 'battle__actions');
  panel.append(field, logList, actions);
  root.append(panel);

  let menu: Menu = 'root';
  let current: ActiveBattle | undefined;

  function speciesOf(side: Side): Species | undefined {
    if (current === undefined) return undefined;
    const team = side === 'player' ? current.state.player : current.state.enemy;
    const active = team.members[team.active];
    return active === undefined ? undefined : deps.context().species.get(active.speciesId);
  }

  function nameOfSpecies(speciesId: string): string {
    const species = deps.context().species.get(speciesId);
    return species === undefined ? speciesId : t(fromData(species.nameKey));
  }

  function activeOf(side: Side): BattleCombatant | undefined {
    if (current === undefined) return undefined;
    const team = side === 'player' ? current.state.player : current.state.enemy;
    return team.members[team.active];
  }

  function renderFighter(side: Side): HTMLElement {
    const card = element('article', `fighter fighter--${side}`);
    const combatant = activeOf(side);
    const species = speciesOf(side);
    if (combatant === undefined || species === undefined) return card;

    const role = element('p', 'fighter__role');
    role.textContent = side === 'enemy' ? t('battle.wild') : t('battle.yours');

    const heading = element('h3', 'fighter__name');
    heading.textContent = t(fromData(species.nameKey));
    if (combatant.isAlpha) {
      const alpha = element('span', 'fighter__alpha');
      alpha.textContent = t('battle.alpha');
      heading.append(alpha);
    }

    const meta = element('p', 'fighter__meta');
    const types = species.types.map((type) => t(fromData(`type.${type}`))).join(' · ');
    meta.textContent = `${t('battle.level', { level: combatant.level })} — ${types}`;

    const hpRatio = Math.max(0, combatant.hp) / Math.max(1, combatant.stats.hp);
    const hpBar = element('div', 'bar bar--hp');
    const hpFill = element('span', 'bar__fill');
    hpFill.style.width = `${(hpRatio * 100).toFixed(1)}%`;
    hpBar.append(hpFill);

    const hpText = element('p', 'fighter__hp');
    hpText.textContent = `${t('battle.hp')} ${Math.max(0, combatant.hp)} / ${combatant.stats.hp}`;

    card.append(role, heading, meta, hpBar, hpText);

    if (combatant.status !== undefined) {
      const status = element('span', 'fighter__status');
      status.textContent = t(fromData(`status.${combatant.status.id}`));
      card.append(status);
    }

    if (side === 'player' && current !== undefined) {
      const atbBar = element('div', 'bar bar--atb');
      const atbFill = element('span', 'bar__fill');
      atbFill.style.width = `${(atbProgress(combatant.atb, deps.context().config) * 100).toFixed(1)}%`;
      atbBar.append(atbFill);
      card.append(atbBar);
    }

    return card;
  }

  function renderLog(): void {
    logList.replaceChildren();
    if (current === undefined) return;

    const naming = {
      speciesOf,
      moveById: (moveId: string) => deps.context().moves.get(moveId),
      itemById: (itemId: string) => deps.context().items.get(itemId),
      partyNameAt: (index: number): string | undefined => {
        const member = current?.state.player.members[index];
        if (member === undefined) return undefined;
        return nameOfSpecies(member.speciesId);
      },
    };

    const enemy = speciesOf('enemy');
    const opening =
      enemy === undefined ? [] : [t('battle.encounter', { name: t(fromData(enemy.nameKey)) })];

    const lines = [...opening, ...current.state.log.flatMap((event) => formatEvent(event, naming))];
    for (const line of lines.slice(-LOG_LINES)) {
      const item = document.createElement('li');
      item.textContent = line;
      logList.append(item);
    }
  }

  function renderRootMenu(): void {
    const player = activeOf('player');
    actions.append(
      button(t('battle.action.fight'), () => {
        menu = 'moves';
        render(current);
      }),
      button(
        t('battle.action.switch'),
        () => {
          menu = 'party';
          render(current);
        },
        (player === undefined ? 0 : (current?.state.player.members.length ?? 0)) < 2,
      ),
      button(t('battle.action.catch'), () => {
        menu = 'tools';
        render(current);
      }),
      button(t('battle.action.item'), () => {
        menu = 'items';
        render(current);
      }),
      button(t('battle.action.flee'), () => {
        deps.submit({ type: 'flee' });
      }),
    );
  }

  function renderMoveMenu(): void {
    const player = activeOf('player');
    const context = deps.context();
    for (const moveId of player?.moves ?? []) {
      const move = context.moves.get(moveId);
      if (move === undefined) continue;
      actions.append(
        button(t(fromData(move.nameKey)), () => {
          menu = 'root';
          deps.submit({ type: 'move', moveId });
        }),
      );
    }
    actions.append(
      button(t('battle.action.back'), () => {
        menu = 'root';
        render(current);
      }),
    );
  }

  function renderPartyMenu(): void {
    const team = current?.state.player;
    team?.members.forEach((member, index) => {
      const species = deps.context().species.get(member.speciesId);
      const label = species === undefined ? member.speciesId : t(fromData(species.nameKey));
      actions.append(
        button(
          `${label} — ${Math.max(0, member.hp)}/${member.stats.hp}`,
          () => {
            menu = 'root';
            deps.submit({ type: 'switch', index });
          },
          member.hp <= 0 || index === team.active,
        ),
      );
    });
    actions.append(
      button(t('battle.action.back'), () => {
        menu = 'root';
        render(current);
      }),
    );
  }

  function renderToolMenu(): void {
    const context = deps.context();
    const target = activeOf('enemy');
    const inventory = deps.getState().inventory;
    let any = false;

    for (const tool of context.config.tools) {
      const count = inventory[tool.id] ?? 0;
      if (count <= 0) continue;
      any = true;

      const usable = isToolUsable(tool, { teamLevel: context.teamLevel, isNight: context.isNight });
      const chance =
        target === undefined
          ? 0
          : captureBreakdown(
              {
                hp: target.hp,
                maxHp: target.stats.hp,
                level: target.level,
                baseCatchRate: target.baseCatchRate,
                status: target.status,
              },
              tool,
              { teamLevel: context.teamLevel, isNight: context.isNight },
              context.config,
            ).chance;

      const name = t(fromData(tool.nameKey));
      const label = usable
        ? `${t('battle.toolCount', { name, count })} — ${Math.round(chance * 100)}%`
        : t('battle.toolNightOnly', { name });

      actions.append(
        button(
          label,
          () => {
            menu = 'root';
            deps.submit({ type: 'capture', toolId: tool.id });
          },
          !usable,
        ),
      );
    }

    const hint = element('p', 'battle__hint');
    if (!any) {
      hint.textContent = t('battle.noTools');
    } else if (deps.getState().party.length >= context.config.partySize) {
      // Senza deposito (Fase 3) una cattura con la squadra piena andrebbe
      // persa in silenzio: meglio dirlo prima di far spendere un Nodo.
      hint.textContent = t('battle.partyFull');
    } else {
      hint.textContent = t('battle.catchHint');
    }
    actions.append(hint);

    actions.append(
      button(t('battle.action.back'), () => {
        menu = 'root';
        render(current);
      }),
    );
  }

  /** Oggetti usabili in combattimento, applicati al Ferale in campo. */
  function renderItemMenu(): void {
    const context = deps.context();
    const inventory = deps.getState().inventory;
    const targetIndex = current?.state.player.active ?? 0;
    let any = false;

    for (const [itemId, count] of Object.entries(inventory)) {
      const item = context.items.get(itemId);
      if (item === undefined || !item.usableInBattle || count <= 0) continue;
      any = true;
      actions.append(
        button(t('roster.useItem', { name: t(fromData(item.nameKey)), count }), () => {
          menu = 'root';
          deps.submit({ type: 'item', itemId, targetIndex });
        }),
      );
    }

    if (!any) {
      const empty = element('p', 'battle__hint');
      empty.textContent = t('battle.noItems');
      actions.append(empty);
    }

    actions.append(
      button(t('battle.action.back'), () => {
        menu = 'root';
        render(current);
      }),
    );
  }

  /** Riepilogo di fine scontro: esperienza, livelli, evoluzioni. */
  function renderSummary(): void {
    const summary = current?.summary;
    if (summary === undefined) return;

    const box = element('div', 'battle__summary');

    if (summary.xp > 0) {
      const xp = document.createElement('p');
      xp.textContent = t('battle.summary.xp', { amount: summary.xp });
      box.append(xp);
    }

    for (const levelUp of summary.levelUps) {
      const line = document.createElement('p');
      line.textContent = t('battle.summary.levelUp', {
        name: t(fromData(levelUp.nameKey)),
        level: levelUp.to,
      });
      box.append(line);
    }

    for (const evolution of summary.evolutions) {
      const line = element('p', 'battle__evolution');
      line.textContent = t('battle.summary.evolution', {
        from: t(fromData(evolution.fromNameKey)),
        to: t(fromData(evolution.toNameKey)),
      });
      box.append(line);
    }

    if (summary.toStorage) {
      const line = document.createElement('p');
      line.textContent = t('battle.summary.toStorage');
      box.append(line);
    }

    if (box.childElementCount > 0) actions.append(box);
  }

  function renderActions(): void {
    actions.replaceChildren();
    if (current === undefined) return;

    if (current.state.phase === 'over') {
      renderSummary();
      actions.append(button(t('battle.continue'), deps.end));
      return;
    }

    if (current.state.phase !== 'awaitingPlayer') {
      const waiting = element('p', 'battle__hint');
      waiting.textContent = t('battle.waiting');
      actions.append(waiting);
      return;
    }

    const species = speciesOf('player');
    const prompt = element('p', 'battle__prompt');
    prompt.textContent = t('battle.turnPrompt', {
      name: species === undefined ? '?' : t(fromData(species.nameKey)),
    });
    actions.append(prompt);

    if (menu === 'moves') renderMoveMenu();
    else if (menu === 'party') renderPartyMenu();
    else if (menu === 'tools') renderToolMenu();
    else if (menu === 'items') renderItemMenu();
    else renderRootMenu();
  }

  function render(active: ActiveBattle | undefined): void {
    current = active;
    panel.hidden = active === undefined;
    if (active === undefined) {
      menu = 'root';
      return;
    }

    field.replaceChildren(renderFighter('enemy'), renderFighter('player'));
    renderLog();
    renderActions();
  }

  const unsubscribe = onLocaleChange(() => {
    render(current);
  });

  return {
    render,
    destroy(): void {
      unsubscribe();
      panel.remove();
    },
  };
}
