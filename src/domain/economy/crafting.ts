import { asArray, asNumber, asRecord, asString } from '../guards';

/**
 * Le ricette del banco da lavoro.
 *
 * Una ricetta consuma risorse della Radura e produce **o** una risorsa **o** un
 * oggetto dello zaino. La differenza non è cosmetica: le risorse restano nella
 * Radura, gli oggetti si portano addosso e un KO ne toglie una parte (E8).
 *
 * La coda vive su ogni banco piazzato (`PlacedStructure.queue`), non in un
 * elenco globale: due banchi con due lavoratori diversi devono poter lavorare
 * a velocità diverse, che è il senso di costruirne un secondo.
 */

export type CraftOutputKind = 'resource' | 'item';

export interface Recipe {
  readonly id: string;
  readonly nameKey: string;
  /** Nodo tecnologico che la rende disponibile. */
  readonly tech: string;
  readonly seconds: number;
  readonly input: Readonly<Record<string, number>>;
  readonly output: {
    readonly id: string;
    readonly kind: CraftOutputKind;
    readonly amount: number;
  };
}

const OUTPUT_KINDS: readonly CraftOutputKind[] = ['resource', 'item'];

export function parseRecipes(raw: unknown): Map<string, Recipe> {
  const root = asRecord(raw, 'recipes.json');
  const recipes = new Map<string, Recipe>();

  for (const [index, entry] of asArray(root['recipes'], 'recipes.json.recipes').entries()) {
    const record = asRecord(entry, `recipes.json.recipes[${index}]`);
    const id = asString(record['id'], `recipes.json.recipes[${index}].id`);
    const output = asRecord(record['output'], `${id}.output`);
    const kind = asString(output['kind'], `${id}.output.kind`);
    if (!OUTPUT_KINDS.includes(kind as CraftOutputKind)) {
      throw new TypeError(`${id}.output.kind: "${kind}" non è fra ${OUTPUT_KINDS.join(', ')}`);
    }

    const input: Record<string, number> = {};
    for (const [resource, amount] of Object.entries(asRecord(record['input'], `${id}.input`))) {
      input[resource] = asNumber(amount, `${id}.input.${resource}`);
    }

    recipes.set(id, {
      id,
      nameKey: asString(record['nameKey'], `${id}.nameKey`),
      tech: asString(record['tech'], `${id}.tech`),
      seconds: asNumber(record['seconds'], `${id}.seconds`),
      input,
      output: {
        id: asString(output['id'], `${id}.output.id`),
        kind: kind as CraftOutputKind,
        amount: asNumber(output['amount'], `${id}.output.amount`),
      },
    });
  }

  return recipes;
}

/** Le ricette che l'albero tecnologico ha già aperto. */
export function availableRecipes(
  recipes: ReadonlyMap<string, Recipe>,
  unlockedTech: readonly string[],
): Recipe[] {
  return [...recipes.values()].filter((recipe) => unlockedTech.includes(recipe.tech));
}

export type QueueRefusal = 'unknownRecipe' | 'techLocked' | 'noStation' | 'queueFull' | 'noWorker';

export interface QueueCheck {
  readonly ok: boolean;
  readonly refusal?: QueueRefusal;
}

/**
 * Quante lavorazioni stanno in coda su un banco.
 *
 * Un tetto c'è di proposito: una coda infinita è un modo di giocare il gioco
 * una volta sola, mettendo in fila trenta ricette e tornando il giorno dopo.
 */
export const MAX_QUEUE = 8;

export interface StationView {
  readonly hasStation: boolean;
  readonly hasWorker: boolean;
  readonly queueLength: number;
}

export function canQueue(
  recipes: ReadonlyMap<string, Recipe>,
  unlockedTech: readonly string[],
  station: StationView,
  recipeId: string,
): QueueCheck {
  const recipe = recipes.get(recipeId);
  if (recipe === undefined) return { ok: false, refusal: 'unknownRecipe' };
  if (!unlockedTech.includes(recipe.tech)) return { ok: false, refusal: 'techLocked' };
  if (!station.hasStation) return { ok: false, refusal: 'noStation' };
  if (!station.hasWorker) return { ok: false, refusal: 'noWorker' };
  if (station.queueLength >= MAX_QUEUE) return { ok: false, refusal: 'queueFull' };
  return { ok: true };
}

/** Le risorse bastano per un ciclo? La coda si può comunque riempire prima. */
export function hasIngredients(
  recipe: Recipe,
  resources: Readonly<Record<string, number>>,
): boolean {
  return Object.entries(recipe.input).every(([id, amount]) => (resources[id] ?? 0) >= amount);
}
