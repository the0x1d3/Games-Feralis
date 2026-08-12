/**
 * Schemi e integrità referenziale della Radura: `base.json` e `structures.json`.
 *
 * Un file a parte da `contentChecks.ts` perché sono due domini diversi e perché
 * quel file aveva già superato le 300 righe (CLAUDE.md, regola 8).
 *
 * Il controllo che conta davvero è l'ultimo: una Radura in cui nessuna
 * struttura produce cibo si spegne da sola dopo qualche ora, e il giocatore non
 * ha modo di capire perché. È il tipo di errore di bilanciamento che si nota
 * solo dopo una sessione lunga, cioè troppo tardi.
 */
import { z } from 'zod';

const WORK_KINDS = ['gathering', 'mining', 'farming', 'flame', 'water', 'crafting'] as const;

/** L'impronta massima che entra nel fotogramma dello sprite (3x2 tile). */
const MAX_WIDTH = 3;
const MAX_HEIGHT = 2;

const amounts = z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.number().positive());

export const baseSchema = z.object({
  totem: z.object({ radiusTiles: z.number().positive() }),
  production: z.object({
    workLevelBonus: z.number().min(0),
    nightFactor: z.number().min(0).max(1),
    moraleThresholds: z.object({
      full: z.number().min(0).max(100),
      low: z.number().min(0).max(100),
    }),
    moraleFactors: z.object({
      full: z.number().positive(),
      low: z.number().positive(),
      exhausted: z.number().positive(),
    }),
  }),
  food: z.object({
    perWorkerPerHour: z.number().positive(),
    moraleRecoverPerHour: z.number().positive(),
    moraleDecayPerHour: z.number().positive(),
    startingMorale: z.number().min(0).max(100),
  }),
  defeat: z.object({ inventoryLossFraction: z.number().min(0).max(1) }),
  offline: z.object({
    capMs: z.number().int().positive(),
    maxSegments: z.number().int().positive(),
  }),
  resources: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'id in snake_case'),
        nameKey: z.string().min(1),
      }),
    )
    .min(1),
});

export const structuresSchema = z.object({
  structures: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'id in snake_case'),
        nameKey: z.string().min(1),
        kind: z.enum(['totem', 'feeder', 'producer']),
        width: z.number().int().min(1).max(MAX_WIDTH),
        height: z.number().int().min(1).max(MAX_HEIGHT),
        cost: amounts,
        frame: z.number().int().min(0),
        work: z.enum(WORK_KINDS).optional(),
        minLevel: z.number().int().min(1).max(3).optional(),
        secondsPerOutput: z.number().positive().optional(),
        input: amounts.optional(),
        output: amounts.optional(),
      }),
    )
    .min(1),
});

export type ParsedBase = z.infer<typeof baseSchema>;
export type ParsedStructures = z.infer<typeof structuresSchema>;

export interface BaseCheckInput {
  readonly base: ParsedBase;
  readonly structures: ParsedStructures;
  readonly translationKeys: ReadonlySet<string>;
}

export function checkBase(input: BaseCheckInput): string[] {
  const errors: string[] = [];
  const resourceIds = new Set(input.base.resources.map((entry) => entry.id));

  const { full, low } = input.base.production.moraleThresholds;
  if (low >= full) {
    errors.push(`base.json: la soglia "low" (${low}) deve stare sotto la "full" (${full})`);
  }

  for (const resource of input.base.resources) {
    if (!input.translationKeys.has(resource.nameKey)) {
      errors.push(`base.json: la risorsa "${resource.id}" cita "${resource.nameKey}", non tradotta`);
    }
  }

  if (!resourceIds.has('cibo')) {
    errors.push('base.json: manca la risorsa "cibo", su cui poggiano fame e morale');
  }

  const frames = new Set<number>();
  const totems = input.structures.structures.filter((entry) => entry.kind === 'totem');
  if (totems.length !== 1) {
    errors.push(`structures.json: serve esattamente un Totem, ne sono dichiarati ${totems.length}`);
  }

  let producesFood = false;

  for (const structure of input.structures.structures) {
    const where = `structures.json → ${structure.id}`;

    if (!input.translationKeys.has(structure.nameKey)) {
      errors.push(`${where}: cita "${structure.nameKey}", non tradotta`);
    }

    if (frames.has(structure.frame)) {
      errors.push(`${where}: il fotogramma ${structure.frame} è già usato da un'altra struttura`);
    }
    frames.add(structure.frame);

    for (const [what, amounts_] of [
      ['cost', structure.cost],
      ['input', structure.input ?? {}],
      ['output', structure.output ?? {}],
    ] as const) {
      for (const id of Object.keys(amounts_)) {
        if (!resourceIds.has(id)) {
          errors.push(`${where}.${what}: la risorsa "${id}" non esiste in base.json`);
        }
      }
    }

    if (structure.kind !== 'producer') {
      if (structure.work !== undefined || structure.output !== undefined) {
        errors.push(`${where}: solo le strutture "producer" hanno mansione e produzione`);
      }
      continue;
    }

    if (structure.work === undefined) errors.push(`${where}: un produttore deve avere una mansione`);
    if (structure.secondsPerOutput === undefined) {
      errors.push(`${where}: un produttore deve dichiarare "secondsPerOutput"`);
    }
    if (structure.output === undefined || Object.keys(structure.output).length === 0) {
      errors.push(`${where}: un produttore senza "output" occupa un Ferale per niente`);
    }
    if (structure.output?.['cibo'] !== undefined && structure.input === undefined) {
      producesFood = true;
    }
  }

  // Senza una fonte di cibo che non consumi ingredienti, la Radura si spegne da
  // sola: il morale scende, la produzione cala, e non c'è modo di risalire.
  if (!producesFood) {
    errors.push('structures.json: nessuna struttura produce cibo senza ingredienti');
  }

  // I fotogrammi indicizzano lo spritesheet generato: devono essere 0..N-1.
  for (let i = 0; i < input.structures.structures.length; i += 1) {
    if (!frames.has(i)) {
      errors.push(`structures.json: manca il fotogramma ${i}; devono essere contigui da 0`);
    }
  }

  return errors;
}
