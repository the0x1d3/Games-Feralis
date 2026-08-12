/**
 * Stato della Radura.
 *
 * Tre accumulatori sono **interi** e non numeri con la virgola: il lavoro
 * svolto, il debito di cibo e il progresso del morale. Non è pignoleria.
 *
 * Il criterio di accettazione della Fase 4 chiede che la produzione simulata a
 * tick e quella simulata a segmenti (ADR 0002) diano risultati **esattamente
 * uguali**. Sommare 3600 volte `rate * 1s` in virgola mobile non dà lo stesso
 * bit di `rate * 3600s`, e alla soglia di un ciclo la differenza diventa una
 * risorsa in più o in meno. Con l'aritmetica intera l'uguaglianza è garantita
 * dalla proprietà distributiva, non dalla fortuna.
 *
 * Unità: `workUnits` sono millisecondi × permille di velocità.
 */

export interface PlacedStructure {
  /** Identificatore dell'esemplare piazzato, univoco nella Radura. */
  readonly id: string;
  readonly structureId: string;
  readonly tx: number;
  readonly ty: number;
  /** Uid del Ferale assegnato, se c'è. */
  readonly workerUid?: string;
  /** Lavoro accumulato, intero. Vedi il commento in testa al file. */
  readonly workUnits: number;
}

export interface BaseState {
  /** La Radura esiste solo dopo che il Totem è stato piantato. */
  readonly totem?: { readonly zoneId: string; readonly tx: number; readonly ty: number };
  readonly structures: readonly PlacedStructure[];
  readonly resources: Readonly<Record<string, number>>;
  /** 0..100. Uno solo per la Radura, non uno per Ferale: vedi ADR 0006. */
  readonly morale: number;
  /** Debito di cibo, in millisecondi × (cibo/ora). Intero. */
  readonly foodDebt: number;
  /** Progresso del morale, in millisecondi × (punti/ora). Intero, con segno. */
  readonly moraleProgress: number;
}

export const MS_PER_HOUR = 3_600_000;

/** Scala della velocità di produzione: 1.0x = 1000. */
export const PERMILLE = 1000;

export function emptyBase(): BaseState {
  return {
    structures: [],
    resources: {},
    morale: 100,
    foodDebt: 0,
    moraleProgress: 0,
  };
}

export function hasTotem(base: BaseState): boolean {
  return base.totem !== undefined;
}

export function resourceOf(base: BaseState, id: string): number {
  return base.resources[id] ?? 0;
}

export function withResources(
  base: BaseState,
  changes: Readonly<Record<string, number>>,
): BaseState {
  const resources = { ...base.resources };
  for (const [id, amount] of Object.entries(changes)) {
    resources[id] = Math.max(0, (resources[id] ?? 0) + amount);
  }
  return { ...base, resources };
}

export function canAfford(base: BaseState, cost: Readonly<Record<string, number>>): boolean {
  return Object.entries(cost).every(([id, amount]) => resourceOf(base, id) >= amount);
}

export function assignedWorkers(base: BaseState): string[] {
  return base.structures
    .map((structure) => structure.workerUid)
    .filter((uid): uid is string => uid !== undefined);
}

export function structureAt(base: BaseState, id: string): PlacedStructure | undefined {
  return base.structures.find((structure) => structure.id === id);
}

export function replaceStructure(base: BaseState, next: PlacedStructure): BaseState {
  return {
    ...base,
    structures: base.structures.map((structure) => (structure.id === next.id ? next : structure)),
  };
}
