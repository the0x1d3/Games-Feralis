import type { BaseConfig, StructureDef } from './config';
import { MS_PER_HOUR, PERMILLE, resourceOf, type BaseState, type PlacedStructure } from './state';

/**
 * Il tick di produzione.
 *
 * Una funzione sola, usata sia online (con `dtMs` di un secondo) sia offline
 * (con `dtMs` di un intero segmento omogeneo, ADR 0002). "Mai due codebase per
 * la stessa regola" — PDR §5.4.
 *
 * **Aritmetica intera.** Il criterio di accettazione della Fase 4 pretende che
 * i due percorsi diano risultati *esattamente* uguali. Con i numeri in virgola
 * mobile 3600 somme di `rate × 1s` non danno lo stesso bit di `rate × 3600s`, e
 * alla soglia di un ciclo quella differenza vale una risorsa. Qui la velocità è
 * un intero in permille e il lavoro si accumula in millisecondi × permille:
 * l'uguaglianza discende dalla proprietà distributiva.
 *
 * **Condizioni costanti.** Chi chiama garantisce che dentro `dtMs` non cambino
 * né la fase del giorno, né lo stato di sazietà, né la fascia di morale. È il
 * compito di `offline.ts`, che spezza il tempo esattamente su quei confini.
 */

export interface Worker {
  readonly uid: string;
  /** Livello nella mansione della struttura, 1..3. */
  readonly workLevel: number;
  readonly nocturnal: boolean;
}

export interface ProductionContext {
  readonly config: BaseConfig;
  readonly structures: ReadonlyMap<string, StructureDef>;
  readonly workers: ReadonlyMap<string, Worker>;
}

export interface ProductionConditions {
  readonly isNight: boolean;
  /**
   * Falso durante il recupero offline: le lavorazioni con ingredienti si
   * fermano mentre non ci sei (ADR 0006). Senza questa regola una catena
   * miniera → fornace dipenderebbe dall'ordine in cui si simula il tempo, e
   * l'uguaglianza fra tick e segmenti smetterebbe di essere dimostrabile.
   */
  readonly allowInputs: boolean;
}

export interface ProduceResult {
  readonly base: BaseState;
  readonly produced: Readonly<Record<string, number>>;
  readonly consumed: Readonly<Record<string, number>>;
}

export type MoraleBand = 'full' | 'low' | 'exhausted';

export function moraleBand(morale: number, config: BaseConfig): MoraleBand {
  const { full, low } = config.production.moraleThresholds;
  if (morale >= full) return 'full';
  if (morale >= low) return 'low';
  return 'exhausted';
}

export function moraleFactor(morale: number, config: BaseConfig): number {
  return config.production.moraleFactors[moraleBand(morale, config)];
}

/**
 * Velocità di una struttura, in permille.
 *
 * Un solo arrotondamento, alla fine: due chiamate con gli stessi ingredienti
 * restituiscono lo stesso intero, ed è questo che rende confrontabili i due
 * percorsi di simulazione.
 */
export function speedPermille(
  worker: Worker,
  base: BaseState,
  conditions: ProductionConditions,
  config: BaseConfig,
): number {
  let multiplier = 1 + config.production.workLevelBonus * (worker.workLevel - 1);
  if (conditions.isNight && !worker.nocturnal) multiplier *= config.production.nightFactor;
  multiplier *= moraleFactor(base.morale, config);
  return Math.max(0, Math.round(multiplier * PERMILLE));
}

/** Costo di un ciclo, nella stessa unità di `workUnits`. */
function cycleCost(def: StructureDef): number {
  return Math.round((def.secondsPerOutput ?? 0) * 1000) * PERMILLE;
}

function activeWorkerCount(base: BaseState, context: ProductionContext): number {
  return base.structures.filter((structure) => {
    if (structure.workerUid === undefined) return false;
    const def = context.structures.get(structure.structureId);
    return def?.kind === 'producer';
  }).length;
}

export function isFed(base: BaseState): boolean {
  return resourceOf(base, 'cibo') > 0;
}

function add(target: Record<string, number>, changes: Readonly<Record<string, number>>, times: number): void {
  for (const [id, amount] of Object.entries(changes)) {
    target[id] = (target[id] ?? 0) + amount * times;
  }
}

export function produce(
  base: BaseState,
  dtMs: number,
  context: ProductionContext,
  conditions: ProductionConditions,
): ProduceResult {
  const produced: Record<string, number> = {};
  const consumed: Record<string, number> = {};

  if (dtMs <= 0 || base.totem === undefined) return { base, produced, consumed };

  const step = Math.floor(dtMs);
  const resources: Record<string, number> = { ...base.resources };
  const workers = activeWorkerCount(base, context);
  const fed = isFed(base);

  /* ------------------------------------------------------------- cibo */

  let foodDebt = base.foodDebt;
  if (fed && workers > 0) {
    foodDebt += step * workers * context.config.food.perWorkerPerHour;
    while (foodDebt >= MS_PER_HOUR && (resources['cibo'] ?? 0) > 0) {
      resources['cibo'] = (resources['cibo'] ?? 0) - 1;
      consumed['cibo'] = (consumed['cibo'] ?? 0) + 1;
      foodDebt -= MS_PER_HOUR;
    }
  }

  /* ----------------------------------------------------------- morale */

  const { moraleRecoverPerHour, moraleDecayPerHour } = context.config.food;
  let morale = base.morale;
  let moraleProgress = base.moraleProgress;

  if (workers > 0) {
    moraleProgress += step * (fed ? moraleRecoverPerHour : -moraleDecayPerHour);
    while (moraleProgress >= MS_PER_HOUR && morale < 100) {
      morale += 1;
      moraleProgress -= MS_PER_HOUR;
    }
    while (moraleProgress <= -MS_PER_HOUR && morale > 0) {
      morale -= 1;
      moraleProgress += MS_PER_HOUR;
    }
    // Ai due estremi il progresso non si accumula all'infinito, altrimenti
    // rimettere cibo non avrebbe effetto per ore.
    if (morale >= 100) moraleProgress = Math.min(moraleProgress, 0);
    if (morale <= 0) moraleProgress = Math.max(moraleProgress, 0);
  }

  /* ------------------------------------------------------- produzione */

  const structures: PlacedStructure[] = base.structures.map((structure) => {
    const def = context.structures.get(structure.structureId);
    const worker = structure.workerUid === undefined ? undefined : context.workers.get(structure.workerUid);

    if (def === undefined || def.kind !== 'producer' || worker === undefined) return structure;
    if (def.input !== undefined && !conditions.allowInputs) return structure;

    const cost = cycleCost(def);
    if (cost <= 0) return structure;

    // La velocità si calcola sul morale di PARTENZA del segmento: chi chiama
    // garantisce che la fascia non cambi dentro `dtMs`.
    const speed = speedPermille(worker, base, conditions, context.config);
    let workUnits = structure.workUnits + step * speed;

    let cycles = Math.floor(workUnits / cost);
    if (cycles <= 0) return { ...structure, workUnits };

    if (def.input !== undefined) {
      for (const [id, amount] of Object.entries(def.input)) {
        cycles = Math.min(cycles, Math.floor((resources[id] ?? 0) / amount));
      }
    }
    if (cycles <= 0) return { ...structure, workUnits };

    workUnits -= cycles * cost;

    if (def.input !== undefined) {
      for (const [id, amount] of Object.entries(def.input)) {
        resources[id] = (resources[id] ?? 0) - amount * cycles;
      }
      add(consumed, def.input, cycles);
    }
    for (const [id, amount] of Object.entries(def.output ?? {})) {
      resources[id] = (resources[id] ?? 0) + amount * cycles;
    }
    add(produced, def.output ?? {}, cycles);

    return { ...structure, workUnits };
  });

  return {
    base: { ...base, resources, structures, morale, moraleProgress, foodDebt },
    produced,
    consumed,
  };
}
