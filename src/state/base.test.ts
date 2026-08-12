import { beforeEach, describe, expect, it } from 'vitest';
import altopianoMap from '@data/maps/altopiano.json';
import baseData from '@data/base.json';
import battleData from '@data/battle.json';
import boscoMap from '@data/maps/bosco.json';
import costaMap from '@data/maps/costa.json';
import creatureData from '@data/creatures.json';
import itemData from '@data/items.json';
import structureData from '@data/structures.json';
import tilesData from '@data/world/tiles.json';
import worldData from '@data/world/world.json';
import dewSprout from '@data/species/dew_sprout.json';
import stoneGrub from '@data/species/stone_grub.json';
import tideFin from '@data/species/tide_fin.json';
import { parseBaseConfig, parseStructures } from '@domain/base/config';
import { canPlace } from '@domain/base/layout';
import { simulateOffline } from '@domain/base/offline';
import { parseBattleConfig } from '@domain/battle/config';
import { TICK_MS } from '@domain/clock';
import { createCreature } from '@domain/creature/instance';
import { parseSpecies, type Species } from '@domain/creature/species';
import { parseCreatureConfig } from '@domain/creature/stats';
import { parseItems } from '@domain/economy/items';
import { createRng } from '@domain/rng';
import { parseWorldConfig } from '@domain/world/config';
import { NO_INPUT } from '@domain/world/movement';
import { parseTileRules, parseZone } from '@domain/world/tiled';
import { findSpawn, type Zone } from '@domain/world/zone';
import { workersOf } from './baseActions';
import { createNewGame, type GameState } from './gameState';
import { createStore, type ReducerDeps, type Store } from './store';

/**
 * La Radura vista dallo store, cioè come la vede il gioco vero.
 *
 * Il criterio di accettazione della Fase 4 chiede tre cose: che si possano
 * assegnare tre creature, che riaprendo la scheda le risorse siano *esattamente*
 * quelle calcolate, e che spostare l'orologio indietro non produca nulla.
 * L'uguaglianza fra tick e segmenti è dimostrata anche qui, sul percorso che
 * esegue davvero il gioco, e non solo sulle funzioni pure.
 */

const rules = parseTileRules(tilesData);
const config = parseWorldConfig(worldData);
const baseConfig = parseBaseConfig(baseData);
const structureDefs = parseStructures(structureData);
const creatureConfig = parseCreatureConfig(creatureData);

const zones = new Map<string, Zone>(
  Object.entries({ costa: costaMap, bosco: boscoMap, altopiano: altopianoMap }).map(([id, raw]) => [
    id,
    parseZone(raw, id, rules),
  ]),
);

const species = new Map<string, Species>([
  ['dew_sprout', parseSpecies(dewSprout, 'dew_sprout')],
  ['stone_grub', parseSpecies(stoneGrub, 'stone_grub')],
  ['tide_fin', parseSpecies(tideFin, 'tide_fin')],
]);

const deps: ReducerDeps = {
  config,
  zones,
  partySize: parseBattleConfig(battleData).partySize,
  species,
  creatures: creatureConfig,
  items: parseItems(itemData),
  baseConfig,
  structureDefs,
};

let uidCounter = 0;
function creature(speciesId: string) {
  const found = species.get(speciesId);
  if (found === undefined) throw new Error(`specie assente: ${speciesId}`);
  uidCounter += 1;
  return createCreature(
    { species: found, level: 8, isAlpha: false, caughtAt: 0 },
    creatureConfig,
    createRng(uidCounter * 977),
  );
}

function newGame(): GameState {
  const start = zones.get(config.startZoneId);
  if (start === undefined) throw new Error('zona iniziale assente');
  const spawn = findSpawn(start, config.startSpawn);
  return createNewGame({
    now: 1_700_000_000_000,
    masterSeed: 12345,
    gameVersion: 'test',
    config,
    spawn: { x: spawn.x, y: spawn.y },
  });
}

/**
 * La prima casella su cui la struttura ci sta davvero.
 *
 * La sceglie `canPlace`, cioè la stessa funzione che usa il gioco: un test che
 * si scrive a mano le coordinate si rompe alla prima modifica alla mappa, e non
 * dice perché.
 */
function spotFor(store: Store, structureId: string): { tx: number; ty: number } {
  const state = store.getState();
  const zone = zones.get(state.player.zoneId);
  const def = structureDefs.get(structureId);
  if (zone === undefined || def === undefined) throw new Error('zona o struttura assente');

  for (let ty = 0; ty < zone.collision.height; ty += 1) {
    for (let tx = 0; tx < zone.collision.width; tx += 1) {
      const check = canPlace(def, tx, ty, {
        base: state.base,
        structures: structureDefs,
        config: baseConfig,
        grid: zone.collision,
        zoneId: state.player.zoneId,
      });
      if (check.ok) return { tx, ty };
    }
  }
  throw new Error(`nessuna casella valida per ${structureId}`);
}

/** Pianta il Totem e riempie il magazzino: il punto di partenza di quasi tutto. */
function plant(): void {
  store.dispatch({ type: 'plantTotem', zoneId: 'costa', ...spotFor(store, 'totem') });
  store.dispatch({
    type: 'applyOffline',
    base: { ...store.getState().base, resources: { legna: 200, pietra: 200, cibo: 200 } },
    gameTimeMs: store.getState().world.gameTimeMs,
  });
}

/** Costruisce dove ci sta e restituisce l'esemplare piazzato. */
function build(structureId: string) {
  store.dispatch({ type: 'build', structureId, ...spotFor(store, structureId) });
  const placed = store.getState().base.structures.at(-1);
  if (placed === undefined) throw new Error(`${structureId} non piazzata`);
  return placed;
}

let store: Store;

beforeEach(() => {
  store = createStore(newGame(), deps);
});

describe('piantare il Totem', () => {
  it('crea la Radura e la disegna come struttura', () => {
    const spot = spotFor(store, 'totem');
    store.dispatch({ type: 'plantTotem', zoneId: 'costa', ...spot });

    const base = store.getState().base;
    expect(base.totem).toEqual({ zoneId: 'costa', ...spot });
    // Il Totem è anche una struttura piazzata: occupa spazio come le altre.
    expect(base.structures).toHaveLength(1);
  });

  /* Un Totem solo: le basi multiple sono un moltiplicatore di bug (PDR, App. A). */
  it('il secondo Totem non fa nulla', () => {
    plant();
    store.dispatch({ type: 'plantTotem', zoneId: 'bosco', tx: 5, ty: 5 });
    expect(store.getState().base.totem?.zoneId).toBe('costa');
  });

  it('non si pianta dentro uno scoglio', () => {
    const zone = zones.get('costa');
    if (zone === undefined) throw new Error('zona assente');
    const index = zone.collision.solid.indexOf(1);
    expect(index).toBeGreaterThanOrEqual(0);

    store.dispatch({
      type: 'plantTotem',
      zoneId: 'costa',
      tx: index % zone.collision.width,
      ty: Math.floor(index / zone.collision.width),
    });
    expect(store.getState().base.totem).toBeUndefined();
  });
});

describe('costruire e assegnare', () => {
  it('costruire toglie le risorse, smontare ne restituisce metà', () => {
    plant();
    const placed = build('cava');
    expect(store.getState().base.resources['legna']).toBe(200 - 15);

    store.dispatch({ type: 'demolish', id: placed.id });
    expect(store.getState().base.resources['legna']).toBe(200 - 15 + 7);
    expect(store.getState().base.structures).toHaveLength(1);
  });

  it('il Totem non si smonta', () => {
    plant();
    const totem = store.getState().base.structures[0];
    if (totem === undefined) throw new Error('Totem assente');

    store.dispatch({ type: 'demolish', id: totem.id });
    expect(store.getState().base.structures).toHaveLength(1);
  });

  it('non si costruisce senza risorse', () => {
    plant();
    // La casella si sceglie con il magazzino pieno, poi lo si svuota: così a
    // fallire è il costo e non la posizione.
    const spot = spotFor(store, 'cava');
    store.dispatch({
      type: 'applyOffline',
      base: { ...store.getState().base, resources: {} },
      gameTimeMs: store.getState().world.gameTimeMs,
    });

    store.dispatch({ type: 'build', structureId: 'cava', ...spot });
    expect(store.getState().base.structures).toHaveLength(1);
  });

  /* IL criterio della Fase 4: tre creature al lavoro. */
  it('tre Ferali su tre strutture diverse', () => {
    plant();
    const trio = [creature('dew_sprout'), creature('stone_grub'), creature('tide_fin')];
    for (const entry of trio) {
      store.dispatch({ type: 'grantCreature', creature: entry, caught: false });
    }

    const placed = ['taglialegna', 'cava', 'pozzo'].map((id) => build(id));
    expect(placed).toHaveLength(3);

    placed.forEach((entry, index) => {
      const worker = trio[index];
      if (worker === undefined) return;
      store.dispatch({ type: 'assignWorker', structureId: entry.id, uid: worker.uid });
    });

    const assigned = store.getState().base.structures.filter((s) => s.workerUid !== undefined);
    expect(assigned).toHaveLength(3);
    expect(workersOf(store.getState(), deps).size).toBe(3);
  });

  /* Un Ferale a terra non lavora: sarebbe una via per ignorare le sconfitte. */
  it('un Ferale a terra non viene assegnato', () => {
    plant();
    const hurt = { ...creature('dew_sprout'), hp: 0 };
    store.dispatch({ type: 'grantCreature', creature: hurt, caught: false });

    const placed = build('taglialegna');
    store.dispatch({ type: 'assignWorker', structureId: placed.id, uid: hurt.uid });
    expect(store.getState().base.structures.at(-1)?.workerUid).toBeUndefined();
  });
});

describe('tick contro recupero offline', () => {
  /*
   * IL criterio di accettazione: "riapri dopo dieci minuti e trovi la quantità
   * di risorse esattamente uguale a quella calcolata". Qui i dieci minuti si
   * percorrono in due modi — tick dopo tick e in segmenti — e devono coincidere
   * fino all'unità.
   */
  it('dieci minuti danno le stesse risorse dei tick', () => {
    plant();
    const worker = creature('dew_sprout');
    store.dispatch({ type: 'grantCreature', creature: worker, caught: false });

    const placed = build('taglialegna');
    store.dispatch({ type: 'assignWorker', structureId: placed.id, uid: worker.uid });

    const start = store.getState();
    const tenMinutes = 10 * 60_000;

    const bySegments = simulateOffline(
      { base: start.base, gameTimeMs: start.world.gameTimeMs, elapsedMs: tenMinutes },
      {
        config: baseConfig,
        structures: structureDefs,
        workers: workersOf(start, deps),
        time: config.time,
      },
    );

    for (let i = 0; i < tenMinutes / TICK_MS; i += 1) {
      store.dispatch({ type: 'tick', deltaMs: TICK_MS, input: NO_INPUT });
    }

    const byTicks = store.getState();
    expect(byTicks.base.resources).toEqual(bySegments.base.resources);
    expect(byTicks.base.morale).toBe(bySegments.base.morale);
    expect(byTicks.world.gameTimeMs).toBe(bySegments.gameTimeMs);
    // Se non avesse prodotto nulla, l'uguaglianza sarebbe vera e inutile.
    expect(byTicks.base.resources['legna']).toBeGreaterThan(200 - 8);
  });

  it('senza lavoratori la Radura non produce e non consuma', () => {
    store.dispatch({ type: 'plantTotem', zoneId: 'costa', ...spotFor(store, 'totem') });

    for (let i = 0; i < 600; i += 1) {
      store.dispatch({ type: 'tick', deltaMs: TICK_MS, input: NO_INPUT });
    }

    expect(store.getState().base.resources).toEqual({});
    expect(store.getState().base.morale).toBe(100);
  });
});
