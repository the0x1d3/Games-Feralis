import { describe, expect, it } from 'vitest';
import recipeData from '@data/recipes.json';
import techData from '@data/tech.json';
import { availableRecipes, canQueue, hasIngredients, parseRecipes, MAX_QUEUE } from './crafting';
import { canUnlock, parseTech, totalCost, unreachableNodes } from './tech';

/**
 * L'albero tecnologico e le code del banco.
 *
 * Il criterio di accettazione della Fase 5 chiede "nessun deadlock possibile
 * (test di raggiungibilità di ogni nodo tech)": è l'ultimo blocco di questo
 * file, e gira sull'albero vero di `data/tech.json`, non su uno finto.
 */

const config = parseTech(techData);
const recipes = parseRecipes(recipeData);

const NO_FLAGS = {};

function state(unlocked: readonly string[], points: number) {
  return { unlocked, points, flags: NO_FLAGS };
}

describe('sbloccare un nodo', () => {
  it('rifiuta un nodo che non esiste', () => {
    expect(canUnlock(config, state([], 99), 'inventato').refusal).toBe('unknownNode');
  });

  it('rifiuta due volte lo stesso nodo', () => {
    expect(canUnlock(config, state(['utensili'], 99), 'utensili').refusal).toBe('alreadyUnlocked');
  });

  it('pretende i prerequisiti', () => {
    expect(canUnlock(config, state([], 99), 'carpenteria').refusal).toBe('missingRequirement');
  });

  it('pretende i punti', () => {
    expect(canUnlock(config, state([], 0), 'utensili').refusal).toBe('notEnoughPoints');
    expect(canUnlock(config, state([], 1), 'utensili').ok).toBe(true);
  });

  /* Il tier successivo si apre con un numero di nodi, non con uno solo. */
  it('tiene chiuso il tier finché il precedente non è abbastanza esplorato', () => {
    const solo = ['utensili', 'muratura'];
    expect(canUnlock(config, state(solo, 99), 'metallurgia').refusal).toBe('tierLocked');

    const tre = [...solo, 'carpenteria'];
    expect(canUnlock(config, state(tre, 99), 'metallurgia').ok).toBe(true);
  });
});

describe('nessun vicolo cieco', () => {
  /*
   * IL test del criterio di accettazione. Simula il giocatore più diligente:
   * sblocca tutto quel che può finché non cambia più nulla. Se resta fuori
   * anche un solo nodo, c'è un ramo che nessuno potrà mai vedere.
   */
  it('ogni nodo è raggiungibile con i punti che il gioco distribuisce', () => {
    // 11 specie + 4 Custodi da 5 + 12 obiettivi: i numeri dell'MVP.
    const budget = 11 * config.points.firstEncounter + 4 * config.points.guardian + 12;
    expect(unreachableNodes(config, budget)).toEqual([]);
  });

  it('con pochi punti restano fuori dei nodi: il test sa davvero fallire', () => {
    expect(unreachableNodes(config, 2).length).toBeGreaterThan(0);
  });

  it('l albero costa meno di quanto il gioco distribuisca', () => {
    const budget = 11 * config.points.firstEncounter + 4 * config.points.guardian + 12;
    expect(totalCost(config)).toBeLessThanOrEqual(budget);
  });
});

describe('ricette e code', () => {
  it('mostra solo le ricette che l albero ha aperto', () => {
    expect(availableRecipes(recipes, [])).toEqual([]);
    const aperte = availableRecipes(recipes, ['carpenteria']);
    expect(aperte.length).toBeGreaterThan(0);
    expect(aperte.every((recipe) => recipe.tech === 'carpenteria')).toBe(true);
  });

  it('un banco senza lavoratore non accetta code', () => {
    const check = canQueue(
      recipes,
      ['carpenteria'],
      { hasStation: true, hasWorker: false, queueLength: 0 },
      'assi',
    );
    expect(check.refusal).toBe('noWorker');
  });

  it('una ricetta bloccata dall albero non entra in coda', () => {
    const check = canQueue(
      recipes,
      [],
      { hasStation: true, hasWorker: true, queueLength: 0 },
      'assi',
    );
    expect(check.refusal).toBe('techLocked');
  });

  /* Una coda infinita è un modo di giocare il gioco una volta sola. */
  it('la coda ha un tetto', () => {
    const check = canQueue(
      recipes,
      ['carpenteria'],
      { hasStation: true, hasWorker: true, queueLength: MAX_QUEUE },
      'assi',
    );
    expect(check.refusal).toBe('queueFull');
  });

  it('gli ingredienti si contano sulle risorse della Radura', () => {
    const assi = recipes.get('assi');
    expect(assi).toBeDefined();
    if (assi === undefined) return;

    expect(hasIngredients(assi, { legna: 3 })).toBe(false);
    expect(hasIngredients(assi, { legna: 4 })).toBe(true);
  });
});
