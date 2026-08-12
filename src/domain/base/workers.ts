import type { CreatureInstance } from '../creature/instance';
import type { Species } from '../creature/species';
import type { StructureDef } from './config';
import {
  assignedWorkers,
  replaceStructure,
  structureAt,
  type BaseState,
  type PlacedStructure,
} from './state';

/**
 * Assegnazione dei lavoratori.
 *
 * È qui che il secondo pilastro del gioco diventa una regola: ogni Ferale ha
 * una scheda di lavoro oltre a quella di combattimento (PDR §1.3), e una
 * struttura accetta solo chi ha la mansione giusta al livello giusto. Il
 * Ferale inutile in battaglia può essere il migliore in fornace, e viceversa.
 */

export type AssignRefusal =
  | 'noStructure'
  | 'notProducer'
  | 'noCreature'
  | 'wrongWork'
  | 'lowLevel'
  | 'alreadyAssigned'
  | 'fainted';

export interface AssignCheck {
  readonly ok: boolean;
  readonly refusal?: AssignRefusal;
}

/** Livello del Ferale nella mansione richiesta. 0 significa "non la sa fare". */
export function workLevelOf(species: Species, work: string | undefined): number {
  if (work === undefined) return 0;
  return species.work[work as keyof typeof species.work] ?? 0;
}

export function canAssign(
  base: BaseState,
  structureId: string,
  creature: CreatureInstance,
  species: Species,
  structures: ReadonlyMap<string, StructureDef>,
): AssignCheck {
  const placed = structureAt(base, structureId);
  if (placed === undefined) return { ok: false, refusal: 'noStructure' };

  const def = structures.get(placed.structureId);
  if (def === undefined || def.kind !== 'producer') return { ok: false, refusal: 'notProducer' };

  // Un Ferale a terra non lavora: sarebbe una via per ignorare le sconfitte.
  if (creature.hp <= 0) return { ok: false, refusal: 'fainted' };

  if (assignedWorkers(base).includes(creature.uid) && placed.workerUid !== creature.uid) {
    return { ok: false, refusal: 'alreadyAssigned' };
  }

  const level = workLevelOf(species, def.work);
  if (level <= 0) return { ok: false, refusal: 'wrongWork' };
  if (level < (def.minLevel ?? 1)) return { ok: false, refusal: 'lowLevel' };

  return { ok: true };
}

/**
 * Toglie il lavoratore da una struttura.
 *
 * Con `exactOptionalPropertyTypes` la chiave va omessa, non messa a
 * `undefined`: da qui il rest invece dello spread con la chiave azzerata.
 */
function clearWorker(structure: PlacedStructure): PlacedStructure {
  const { workerUid: _scarta, ...rest } = structure;
  return { ...rest, workUnits: 0 };
}

/**
 * Assegna un Ferale.
 *
 * Il lavoro accumulato si azzera al cambio: lasciarlo significherebbe che
 * togliere un lavoratore lento e metterne uno veloce a un soffio dal ciclo
 * regala una produzione che nessuno dei due ha fatto.
 */
export function assign(base: BaseState, structureId: string, uid: string): BaseState {
  const placed = structureAt(base, structureId);
  if (placed === undefined) return base;

  // Un Ferale sta in un posto solo: lo si toglie da dove era prima.
  const cleared: BaseState = {
    ...base,
    structures: base.structures.map((structure) =>
      structure.workerUid === uid ? clearWorker(structure) : structure,
    ),
  };

  return replaceStructure(cleared, { ...placed, workerUid: uid, workUnits: 0 });
}

export function unassign(base: BaseState, structureId: string): BaseState {
  const placed = structureAt(base, structureId);
  if (placed === undefined) return base;
  return replaceStructure(base, clearWorker(placed));
}

/** Toglie dalle strutture i Ferali che non esistono più (rilasciati, scambiati). */
export function pruneWorkers(base: BaseState, existing: ReadonlySet<string>): BaseState {
  return {
    ...base,
    structures: base.structures.map((structure) =>
      structure.workerUid !== undefined && !existing.has(structure.workerUid)
        ? clearWorker(structure)
        : structure,
    ),
  };
}
