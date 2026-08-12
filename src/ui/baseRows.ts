import type { StructureDef } from '@domain/base/config';
import type { PlacedStructure } from '@domain/base/state';
import { canAssign } from '@domain/base/workers';
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
