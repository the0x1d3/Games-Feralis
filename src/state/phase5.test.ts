import { beforeEach, describe, expect, it } from 'vitest';
import altopianoMap from '@data/maps/altopiano.json';
import baseData from '@data/base.json';
import battleData from '@data/battle.json';
import boscoMap from '@data/maps/bosco.json';
import costaMap from '@data/maps/costa.json';
import creatureData from '@data/creatures.json';
import itemData from '@data/items.json';
import recipeData from '@data/recipes.json';
import structureData from '@data/structures.json';
import techData from '@data/tech.json';
import tilesData from '@data/world/tiles.json';
import worldData from '@data/world/world.json';
import dewSprout from '@data/species/dew_sprout.json';
import stoneGrub from '@data/species/stone_grub.json';
import chalkMite from '@data/species/chalk_mite.json';
import { parseBaseConfig, parseStructures } from '@domain/base/config';
import { parseBattleConfig } from '@domain/battle/config';
import { TICK_MS } from '@domain/clock';
import { createCreature } from '@domain/creature/instance';
import { parseSpecies, type Species } from '@domain/creature/species';
import { parseCreatureConfig } from '@domain/creature/stats';
import { parseRecipes } from '@domain/economy/crafting';
import { parseItems } from '@domain/economy/items';
import { parseTech } from '@domain/economy/tech';
import { createRng } from '@domain/rng';
import { parseWorldConfig } from '@domain/world/config';
import { NO_INPUT } from '@domain/world/movement';
import { isCleared, obstaclesOf } from '@domain/world/obstacles';
import { reachableTiles } from '@domain/world/reachability';
import { parseTileRules, parseZone } from '@domain/world/tiled';
import { findSpawn, type Zone } from '@domain/world/zone';
import { collisionFor } from './collisionCache';
import { createNewGame, type GameState } from './gameState';
import { createStore, type ReducerDeps, type Store } from './store';

/**
 * IL criterio di accettazione della Fase 5.
 *
 * «Catturi un Ferale con Estrazione 2 → rompi il masso → accedi all'Altopiano →
 * crafti l'oggetto tier 3 · nessun deadlock possibile.»
 *
 * Il percorso si gioca qui dall'inizio alla fine, sullo stesso riduttore che
 * gira nel browser: punti guadagnati incontrando le specie, nodi sbloccati in
 * catena, masso rimosso, corridoio che si apre, ricetta di tier 3 in coda e
 * oggetto che arriva nello zaino.
 */

const rules = parseTileRules(tilesData);
const config = parseWorldConfig(worldData);
const creatureConfig = parseCreatureConfig(creatureData);
const structureDefs = parseStructures(structureData);
const techConfig = parseTech(techData);

const zones = new Map<string, Zone>(
  Object.entries({ costa: costaMap, bosco: boscoMap, altopiano: altopianoMap }).map(([id, raw]) => [
    id,
    parseZone(raw, id, rules),
  ]),
);

const species = new Map<string, Species>([
  ['dew_sprout', parseSpecies(dewSprout, 'dew_sprout')],
  ['stone_grub', parseSpecies(stoneGrub, 'stone_grub')],
  ['chalk_mite', parseSpecies(chalkMite, 'chalk_mite')],
]);

const deps: ReducerDeps = {
  config,
  zones,
  partySize: parseBattleConfig(battleData).partySize,
  species,
  creatures: creatureConfig,
  items: parseItems(itemData),
  baseConfig: parseBaseConfig(baseData),
  structureDefs,
  recipes: parseRecipes(recipeData),
  tech: techConfig,
};

let uid = 0;
function creature(speciesId: string) {
  const found = species.get(speciesId);
  if (found === undefined) throw new Error(`specie assente: ${speciesId}`);
  uid += 1;
  return createCreature(
    { species: found, level: 10, isAlpha: false, caughtAt: 0 },
    creatureConfig,
    createRng(uid * 613),
  );
}

function newGame(): GameState {
  const start = zones.get(config.startZoneId);
  if (start === undefined) throw new Error('zona iniziale assente');
  const spawn = findSpawn(start, config.startSpawn);
  return createNewGame({
    now: 1_700_000_000_000,
    masterSeed: 4242,
    gameVersion: 'test',
    config,
    spawn: { x: spawn.x, y: spawn.y },
  });
}

function zoneOf(id: string): Zone {
  const zone = zones.get(id);
  if (zone === undefined) throw new Error(`zona assente: ${id}`);
  return zone;
}

/** Il masso che chiude il corridoio verso l'Altopiano. */
function masso() {
  const found = obstaclesOf(zoneOf('bosco')).find((entry) => entry.work === 'mining');
  if (found === undefined) throw new Error('il masso del bosco non esiste piu');
  return found;
}

let store: Store;

beforeEach(() => {
  store = createStore(newGame(), deps);
});

describe('punti tecnologia', () => {
  /* PDR §4.5: il primo incontro con una specie vale un punto. */
  it('il primo incontro con una specie ne dà uno, il secondo no', () => {
    store.dispatch({ type: 'seeSpecies', speciesId: 'dew_sprout' });
    expect(store.getState().techPoints).toBe(techConfig.points.firstEncounter);

    store.dispatch({ type: 'seeSpecies', speciesId: 'dew_sprout' });
    expect(store.getState().techPoints).toBe(techConfig.points.firstEncounter);

    store.dispatch({ type: 'seeSpecies', speciesId: 'stone_grub' });
    expect(store.getState().techPoints).toBe(techConfig.points.firstEncounter * 2);
  });

  it('anche ricevere un Ferale mai visto conta come incontro', () => {
    store.dispatch({ type: 'grantCreature', creature: creature('dew_sprout'), caught: false });
    expect(store.getState().techPoints).toBe(techConfig.points.firstEncounter);
  });

  it('un nodo si sblocca solo se i prerequisiti ci sono e i punti bastano', () => {
    store.dispatch({ type: 'unlockTech', nodeId: 'utensili' });
    expect(store.getState().tech).toEqual([]);

    store.dispatch({ type: 'awardTechPoints', amount: 1 });
    store.dispatch({ type: 'unlockTech', nodeId: 'carpenteria' });
    expect(store.getState().tech).toEqual([]);

    store.dispatch({ type: 'unlockTech', nodeId: 'utensili' });
    expect(store.getState().tech).toEqual(['utensili']);
    expect(store.getState().techPoints).toBe(0);
  });
});

describe('il masso e la strada per l Altopiano', () => {
  it('senza Estrazione 2 il masso resta dov è', () => {
    // dew_sprout ha Raccolta, non Estrazione: non basta averlo in squadra.
    store.dispatch({ type: 'grantCreature', creature: creature('dew_sprout'), caught: false });
    store.dispatch({ type: 'clearObstacle', zoneId: 'bosco', obstacleId: masso().id });
    expect(isCleared(store.getState().flags, 'bosco', masso().id)).toBe(false);
  });

  it('con Estrazione 2 si rimuove, e il corridoio si apre', () => {
    const zone = zoneOf('bosco');
    const spawn = findSpawn(zone, 'from_costa');
    const from = {
      tx: Math.floor(spawn.x / zone.tileSize),
      ty: Math.floor(spawn.y / zone.tileSize),
    };
    const exit = zone.objects.find(
      (object) => object.kind === 'exit' && object.toZone === 'altopiano',
    );
    if (exit === undefined || exit.kind !== 'exit') throw new Error('uscita assente');
    const target =
      Math.floor(exit.y / zone.tileSize) * zone.width + Math.floor(exit.x / zone.tileSize);

    // Prima: chiuso.
    expect(reachableTiles(collisionFor(zone, store.getState().flags), from).has(target)).toBe(
      false,
    );

    // stone_grub ha Estrazione 2: è esattamente il Ferale che serve.
    store.dispatch({ type: 'grantCreature', creature: creature('stone_grub'), caught: false });
    store.dispatch({ type: 'clearObstacle', zoneId: 'bosco', obstacleId: masso().id });
    expect(isCleared(store.getState().flags, 'bosco', masso().id)).toBe(true);

    // Dopo: aperto. È la stessa griglia che usa il movimento nel tick.
    expect(reachableTiles(collisionFor(zone, store.getState().flags), from).has(target)).toBe(true);
  });

  it('un ostacolo che pretende equipaggiamento non si tocca senza', () => {
    const ghiaccio = obstaclesOf(zoneOf('altopiano')).find(
      (entry) => entry.requiresItem !== undefined,
    );
    expect(ghiaccio).toBeDefined();
    if (ghiaccio === undefined) return;

    store.dispatch({ type: 'grantCreature', creature: creature('chalk_mite'), caught: false });
    store.dispatch({ type: 'clearObstacle', zoneId: 'altopiano', obstacleId: ghiaccio.id });
    expect(isCleared(store.getState().flags, 'altopiano', ghiaccio.id)).toBe(false);
  });
});

describe('dal nodo tecnologico all oggetto in mano', () => {
  /*
   * L'ultimo pezzo del criterio. Si sblocca una catena fino al tier 3, si mette
   * in coda la ricetta e si lascia lavorare il banco: l'oggetto deve comparire
   * nello ZAINO, non fra le risorse della Radura (E8).
   */
  it('sblocca il tier 3 e crafta la tunica ignifuga', () => {
    /*
     * Undici punti: esattamente quelli che l'MVP distribuisce incontrando le
     * undici specie, prima che esistano i Custodi. Arrivare al tier 3 ne costa
     * undici, quindi il percorso è teso ma percorribile — se un giorno non lo
     * fosse più, questo test lo direbbe prima di un giocatore.
     */
    store.dispatch({ type: 'awardTechPoints', amount: 11 });

    const catena = [
      // Tier 1: ne servono tre per aprire il tier 2, ma la catena ne chiede sei.
      'utensili',
      'carpenteria',
      'intreccio',
      'muratura',
      'erboristeria',
      'nodi_saldi',
      // Tier 2: tre, che è quel che il tier 3 pretende.
      'tessitura',
      'metallurgia',
      'nodi_tesi',
      // Tier 3.
      'ignifugia',
    ];
    for (const nodeId of catena) store.dispatch({ type: 'unlockTech', nodeId });

    expect(store.getState().tech).toContain('ignifugia');
    expect(store.getState().techPoints).toBe(0);

    // La Radura, con un banco e un Ferale che sa fare Artigianato.
    const totem = { tx: 19, ty: 21 };
    store.dispatch({ type: 'plantTotem', zoneId: 'costa', ...totem });
    store.dispatch({
      type: 'applyOffline',
      base: {
        ...store.getState().base,
        resources: { legna: 200, cibo: 200, tessuto: 10, lingotto: 10 },
      },
      gameTimeMs: store.getState().world.gameTimeMs,
    });

    const artigiano = creature('chalk_mite');
    store.dispatch({ type: 'grantCreature', creature: artigiano, caught: false });
    store.dispatch({ type: 'build', structureId: 'banco', tx: totem.tx + 3, ty: totem.ty });

    const banco = store.getState().base.structures.at(-1);
    expect(banco?.structureId).toBe('banco');
    if (banco === undefined) return;

    store.dispatch({ type: 'assignWorker', structureId: banco.id, uid: artigiano.uid });
    store.dispatch({ type: 'queueCraft', structureId: banco.id, recipeId: 'tunica_ignifuga' });
    expect(store.getState().base.structures.at(-1)?.queue).toEqual(['tunica_ignifuga']);

    // Due minuti di gioco: la ricetta ne chiede 120 secondi.
    for (let i = 0; i < (150 * 1000) / TICK_MS; i += 1) {
      store.dispatch({ type: 'tick', deltaMs: TICK_MS, input: NO_INPUT });
    }

    const state = store.getState();
    expect(state.inventory['tunica_ignifuga']).toBe(1);
    expect(state.base.resources['tessuto']).toBe(10 - 3);
    expect(state.base.resources['lingotto']).toBe(10 - 2);
    // La coda si svuota da sola quando la lavorazione finisce.
    expect(state.base.structures.at(-1)?.queue).toBeUndefined();
  });

  it('una ricetta non sbloccata non entra in coda', () => {
    store.dispatch({ type: 'plantTotem', zoneId: 'costa', tx: 19, ty: 21 });
    store.dispatch({
      type: 'applyOffline',
      base: { ...store.getState().base, resources: { legna: 100, cibo: 50 } },
      gameTimeMs: store.getState().world.gameTimeMs,
    });

    const artigiano = creature('chalk_mite');
    store.dispatch({ type: 'grantCreature', creature: artigiano, caught: false });
    store.dispatch({ type: 'build', structureId: 'banco', tx: 22, ty: 21 });

    const banco = store.getState().base.structures.at(-1);
    if (banco === undefined) return;
    store.dispatch({ type: 'assignWorker', structureId: banco.id, uid: artigiano.uid });
    store.dispatch({ type: 'queueCraft', structureId: banco.id, recipeId: 'lega_scura' });

    expect(store.getState().base.structures.at(-1)?.queue).toBeUndefined();
  });
});
