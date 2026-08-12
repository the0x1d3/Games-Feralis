/**
 * Schemi e integrità di `tech.json` e `recipes.json`.
 *
 * Il controllo che giustifica il file è `unreachableNodes`: il criterio di
 * accettazione della Fase 5 chiede "nessun deadlock possibile (test di
 * raggiungibilità di ogni nodo tech)". Un ramo irraggiungibile non fa crashare
 * nulla — semplicemente il giocatore ci sbatte contro dopo ore, e non ha modo
 * di capire se è colpa sua.
 */
import { z } from 'zod';
import { parseTech, totalCost, unreachableNodes } from '../../src/domain/economy/tech';

const ID = /^[a-z][a-z0-9_]*$/;

export const techSchema = z.object({
  points: z.object({
    firstEncounter: z.number().int().positive(),
    guardian: z.number().int().positive(),
    objective: z.number().int().positive(),
  }),
  tiers: z
    .array(
      z.object({
        tier: z.number().int().positive(),
        requiresNodes: z.number().int().min(0),
        guardianFlag: z.string().nullable(),
      }),
    )
    .min(1),
  nodes: z
    .array(
      z.object({
        id: z.string().regex(ID, 'id in snake_case'),
        nameKey: z.string().min(1),
        tier: z.number().int().positive(),
        cost: z.number().int().positive(),
        requires: z.array(z.string().min(1)),
      }),
    )
    .min(1),
});

export const recipesSchema = z.object({
  recipes: z
    .array(
      z.object({
        id: z.string().regex(ID, 'id in snake_case'),
        nameKey: z.string().min(1),
        tech: z.string().min(1),
        seconds: z.number().positive(),
        input: z.record(z.string().regex(ID), z.number().int().positive()),
        output: z.object({
          id: z.string().regex(ID),
          kind: z.enum(['resource', 'item']),
          amount: z.number().int().positive(),
        }),
      }),
    )
    .min(1),
});

export type ParsedTech = z.infer<typeof techSchema>;
export type ParsedRecipes = z.infer<typeof recipesSchema>;

export interface TechCheckInput {
  readonly tech: ParsedTech;
  readonly recipes: ParsedRecipes;
  readonly resourceIds: ReadonlySet<string>;
  readonly itemIds: ReadonlySet<string>;
  readonly translationKeys: ReadonlySet<string>;
  /** Quanti Punti Tecnologia l'MVP distribuisce davvero. */
  readonly obtainablePoints: number;
}

export function checkTech(input: TechCheckInput): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(input.tech.nodes.map((node) => node.id));
  const tiers = new Set(input.tech.tiers.map((tier) => tier.tier));

  for (const node of input.tech.nodes) {
    const where = `tech.json → ${node.id}`;
    if (!input.translationKeys.has(node.nameKey)) {
      errors.push(`${where}: cita "${node.nameKey}", non tradotta`);
    }
    if (!tiers.has(node.tier)) {
      errors.push(`${where}: tier ${node.tier} non dichiarato in "tiers"`);
    }
    for (const required of node.requires) {
      if (!nodeIds.has(required)) {
        errors.push(`${where}: richiede "${required}", che non esiste`);
      }
    }
  }

  for (const recipe of input.recipes.recipes) {
    const where = `recipes.json → ${recipe.id}`;
    if (!input.translationKeys.has(recipe.nameKey)) {
      errors.push(`${where}: cita "${recipe.nameKey}", non tradotta`);
    }
    if (!nodeIds.has(recipe.tech)) {
      errors.push(`${where}: richiede il nodo "${recipe.tech}", che non esiste`);
    }
    for (const id of Object.keys(recipe.input)) {
      if (!input.resourceIds.has(id)) {
        errors.push(`${where}.input: la risorsa "${id}" non esiste in base.json`);
      }
    }
    const known =
      recipe.output.kind === 'resource'
        ? input.resourceIds.has(recipe.output.id)
        : input.itemIds.has(recipe.output.id);
    if (!known) {
      errors.push(`${where}.output: "${recipe.output.id}" non è ${recipe.output.kind} conosciuto`);
    }
  }

  // Ogni nodo dovrebbe aprire qualcosa: uno che non sblocca nessuna ricetta è
  // un punto speso per niente, e il giocatore se ne accorge dopo averlo speso.
  const opened = new Set(input.recipes.recipes.map((recipe) => recipe.tech));
  for (const node of input.tech.nodes) {
    if (!opened.has(node.id)) {
      errors.push(`tech.json → ${node.id}: non apre nessuna ricetta`);
    }
  }

  /* ------------------------------------------- il controllo che conta */

  const config = parseTech(input.tech);
  const cost = totalCost(config);
  if (cost > input.obtainablePoints) {
    errors.push(
      `l'albero costa ${cost} punti ma la partita ne distribuisce ${input.obtainablePoints}: ` +
        'una parte resterebbe irraggiungibile',
    );
  }

  const unreachable = unreachableNodes(config, input.obtainablePoints);
  for (const id of unreachable) {
    errors.push(`tech.json → ${id}: nessuna sequenza di scelte lo rende raggiungibile`);
  }

  return errors;
}
