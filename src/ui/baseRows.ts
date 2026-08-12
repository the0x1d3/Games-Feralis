import type { StructureDef } from '@domain/base/config';
import type { PlacedStructure } from '@domain/base/state';
import { canAssign } from '@domain/base/workers';
import {
  availableRecipes,
  hasIngredients,
  MAX_QUEUE,
} from '@domain/economy/crafting';
import type { CreatureInstance } from '@domain/creature/instance';
import { t, type TranslationKey } from '@i18n/index';
import type { GameState } from '@state/gameState';
import type { GameContent } from '@state/loadContent';
import type { GameAction } from '@state/store';
import { element, ghostButton, text } from './widgets';

/**
 * La riga di una struttura piazzata: cosa produce, chi ci lavora, come si
 * smonta.
 *
 * Sta fuori da `base.ts` perché è la parte che cresce: ogni struttura nuova
 * aggiunge un caso qui, non nel pannello.
 *
 * I candidati al lavoro si mostrano tutti, anche quelli che non vanno bene, con
 * il pulsante disabilitato: nascondere chi non serve lascerebbe il giocatore a
 * chiedersi dove sia finito il suo Ferale. L'unico escluso è chi non ha nulla a
 * che vedere con la mansione.
 */

export interface RowDeps {
  readonly getState: () => GameState;
  readonly content: GameContent;
  readonly dispatch: (action: GameAction) => void;
  /** Ridisegna il pannello: lo stato è cambiato sotto ai piedi della riga. */
  readonly onChanged: () => void;
}

function fromData(key: string): TranslationKey {
  return key as TranslationKey;
}

export function amountList(amounts: Readonly<Record<string, number>>): string {
  return Object.entries(amounts)
    .map(([id, value]) => `${t(fromData(`resource.${id}`))} ${value}`)
    .join(' · ');
}

export function displayName(creature: CreatureInstance, content: GameContent): string {
  if (creature.nickname !== undefined) return creature.nickname;
  const species = content.species.get(creature.speciesId);
  return species === undefined ? creature.speciesId : t(fromData(species.nameKey));
}

function renderWorkerPicker(
  placed: PlacedStructure,
  def: StructureDef,
  deps: RowDeps,
): HTMLElement {
  const box = element('div', 'radura__workers');
  const state = deps.getState();

  for (const creature of [...state.party, ...state.storage]) {
    const species = deps.content.species.get(creature.speciesId);
    if (species === undefined) continue;

    const check = canAssign(state.base, placed.id, creature, species, deps.content.structures);
    if (!check.ok && check.refusal !== 'alreadyAssigned' && check.refusal !== 'fainted') continue;

    box.append(
      ghostButton(
        t('base.assign', { name: displayName(creature, deps.content) }),
        () => {
          deps.dispatch({ type: 'assignWorker', structureId: placed.id, uid: creature.uid });
          deps.onChanged();
        },
        !check.ok,
      ),
    );
  }

  if (box.childElementCount === 0) {
    box.append(
      text(
        'p',
        'radura__meta',
        t('base.noCandidate', { work: t(fromData(`work.${def.work ?? 'none'}`)) }),
      ),
    );
  }

  return box;
}

function workerOf(state: GameState, uid: string | undefined): CreatureInstance | undefined {
  if (uid === undefined) return undefined;
  return [...state.party, ...state.storage].find((entry) => entry.uid === uid);
}

/**
 * La coda di un banco da lavoro.
 *
 * Mostra prima cosa c'è in fila (annullabile) e poi cosa si può aggiungere.
 * Le ricette non sbloccate non compaiono affatto: un elenco di trenta voci
 * spente al minuto dieci direbbe soltanto "non puoi", e l'albero delle
 * tecnologie esiste per dire *quando* si potrà.
 */
function renderQueue(placed: PlacedStructure, deps: RowDeps): HTMLElement {
  const box = element('div', 'radura__queue');
  const state = deps.getState();
  const queue = placed.queue ?? [];

  box.append(text('h4', 'radura__name', t('craft.title')));

  if (placed.workerUid === undefined) {
    box.append(text('p', 'radura__meta', t('craft.noWorker')));
    return box;
  }

  if (queue.length === 0) {
    box.append(text('p', 'radura__meta', t('craft.empty')));
  } else {
    box.append(text('p', 'radura__meta', t('craft.queue', { count: queue.length })));
    queue.forEach((recipeId, index) => {
      const recipe = deps.content.recipes.get(recipeId);
      const name = recipe === undefined ? recipeId : t(fromData(recipe.nameKey));
      box.append(
        ghostButton(`${index + 1}. ${name} — ${t('craft.cancel')}`, () => {
          deps.dispatch({ type: 'cancelCraft', structureId: placed.id, index });
          deps.onChanged();
        }),
      );
    });
  }

  const available = availableRecipes(deps.content.recipes, state.tech);
  if (available.length === 0) {
    box.append(text('p', 'radura__meta', t('craft.locked')));
    return box;
  }

  for (const recipe of available) {
    const row = element('article', 'radura__recipe');
    row.append(
      ghostButton(
        `${t(fromData(recipe.nameKey))} — ${t('craft.add')}`,
        () => {
          deps.dispatch({ type: 'queueCraft', structureId: placed.id, recipeId: recipe.id });
          deps.onChanged();
        },
        !hasIngredients(recipe, state.base.resources) || queue.length >= MAX_QUEUE,
      ),
      text('p', 'radura__meta', t('craft.needs', { what: amountList(recipe.input) })),
      text(
        'p',
        'radura__meta',
        t('craft.makes', {
          what: `${outputName(recipe.output.id, deps)} ${recipe.output.amount}`,
          seconds: recipe.seconds,
        }),
      ),
    );
    box.append(row);
  }

  return box;
}

/** Il nome di quel che esce: può essere una risorsa o un oggetto dello zaino. */
function outputName(id: string, deps: RowDeps): string {
  const resource = deps.content.base.resources.find((entry) => entry.id === id);
  if (resource !== undefined) return t(fromData(resource.nameKey));
  const item = deps.content.items.get(id);
  if (item !== undefined) return t(fromData(item.nameKey));
  const tool = deps.content.battle.tools.find((entry) => entry.id === id);
  return tool === undefined ? id : t(fromData(tool.nameKey));
}

export function renderStructureRow(placed: PlacedStructure, deps: RowDeps): HTMLElement {
  const def = deps.content.structures.get(placed.structureId);
  const row = element('article', 'radura__row');
  if (def === undefined) return row;

  row.append(text('h3', 'radura__name', t(fromData(def.nameKey))));

  if (def.kind === 'producer') {
    row.append(
      text(
        'p',
        'radura__meta',
        t('base.produces', {
          what: amountList(def.output ?? {}),
          seconds: def.secondsPerOutput ?? 0,
        }),
      ),
    );

    const worker = workerOf(deps.getState(), placed.workerUid);
    row.append(
      text(
        'p',
        'radura__meta',
        worker === undefined
          ? t('base.noWorker')
          : t('base.worker', { name: displayName(worker, deps.content) }),
      ),
    );

    if (worker === undefined) {
      row.append(renderWorkerPicker(placed, def, deps));
    } else {
      row.append(
        ghostButton(t('base.unassign'), () => {
          deps.dispatch({ type: 'unassignWorker', structureId: placed.id });
          deps.onChanged();
        }),
      );
    }
  }

  // Il banco è l'unica struttura con una coda: è lì che il giocatore sceglie
  // cosa fare, invece di subire una produzione fissa.
  if (def.work === 'crafting') row.append(renderQueue(placed, deps));

  // Il Totem non si smonta: senza, la Radura resterebbe rivendicata da un
  // centro che non c'è più. Lo impedisce anche il riduttore.
  if (def.kind !== 'totem') {
    row.append(
      ghostButton(t('base.demolish'), () => {
        deps.dispatch({ type: 'demolish', id: placed.id });
        deps.onChanged();
      }),
    );
  }

  return row;
}
