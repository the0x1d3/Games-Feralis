import { beforeEach, describe, expect, it } from 'vitest';
import altopianoMap from '@data/maps/altopiano.json';
import boscoMap from '@data/maps/bosco.json';
import costaMap from '@data/maps/costa.json';
import tilesData from '@data/world/tiles.json';
import worldData from '@data/world/world.json';
import { TICK_MS } from '@domain/clock';
import { parseWorldConfig } from '@domain/world/config';
import { exitUnder } from '@domain/world/interaction';
import { NO_INPUT, type MoveInput } from '@domain/world/movement';
import { parseTileRules, parseZone } from '@domain/world/tiled';
import { readClock } from '@domain/world/time';
import { findSpawn, type Zone } from '@domain/world/zone';
import baseData from '@data/base.json';
import battleData from '@data/battle.json';
import creatureData from '@data/creatures.json';
import itemData from '@data/items.json';
import recipeData from '@data/recipes.json';
import structureData from '@data/structures.json';
import techData from '@data/tech.json';
import dewSprout from '@data/species/dew_sprout.json';
import verdantStalk from '@data/species/verdant_stalk.json';
import { parseBaseConfig, parseStructures } from '@domain/base/config';
import { parseBattleConfig } from '@domain/battle/config';
import { createCreature } from '@domain/creature/instance';
import { parseSpecies, type Species } from '@domain/creature/species';
import { parseCreatureConfig } from '@domain/creature/stats';
import { parseRecipes } from '@domain/economy/crafting';
import { parseItems } from '@domain/economy/items';
import { parseTech } from '@domain/economy/tech';
import { createRng } from '@domain/rng';
import { createNewGame, type GameState } from './gameState';
import { createStore, type ReducerDeps, type Store } from './store';

/**
 * Simulazione della partita vera, senza Phaser.
 *
 * E' il test che sostituisce il "cammino a mano fino al bosco e guardo se
 * funziona" del criterio di accettazione della Fase 1. Gira in millisecondi,
 * gira in CI, e non dipende da un browser visibile — la scena Phaser si limita
 * a disegnare quello che qui viene calcolato.
 */

const rules = parseTileRules(tilesData);
const config = parseWorldConfig(worldData);

const zones = new Map<string, Zone>(
  Object.entries({ costa: costaMap, bosco: boscoMap, altopiano: altopianoMap }).map(([id, raw]) => [
    id,
    parseZone(raw, id, rules),
  ]),
);

const battleConfig = parseBattleConfig(battleData);
const creatureConfig = parseCreatureConfig(creatureData);
const species = new Map<string, Species>([
  ['dew_sprout', parseSpecies(dewSprout, 'dew_sprout')],
  ['verdant_stalk', parseSpecies(verdantStalk, 'verdant_stalk')],
]);

const deps: ReducerDeps = {
  config,
  zones,
  partySize: battleConfig.partySize,
  species,
  creatures: creatureConfig,
  items: parseItems(itemData),
  baseConfig: parseBaseConfig(baseData),
  structureDefs: parseStructures(structureData),
  recipes: parseRecipes(recipeData),
  tech: parseTech(techData),
};

function speciesOf(id: string): Species {
  const found = species.get(id);
  if (found === undefined) throw new Error(`specie assente dal test: ${id}`);
  return found;
}

let uidCounter = 0;
function creature(level = 5, id = 'dew_sprout') {
  uidCounter += 1;
  return createCreature(
    { species: speciesOf(id), level, isAlpha: false, caughtAt: 0 },
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
 * Un passo del ciclo di gioco: e' la stessa sequenza che esegue WorldScene,
 * cioe' un tick e poi il controllo delle uscite.
 */
function tick(store: Store, input: MoveInput): void {
  store.dispatch({ type: 'tick', deltaMs: TICK_MS, input });

  const state = store.getState();
  const zone = zones.get(state.player.zoneId);
  if (zone === undefined) return;

  const exit = exitUnder(zone, { ...state.player, moving: false });
  if (exit === undefined) return;

  const destination = zones.get(exit.toZone);
  if (destination === undefined) return;
  const spawn = findSpawn(destination, exit.toSpawn);
  store.dispatch({ type: 'enterZone', zoneId: exit.toZone, x: spawn.x, y: spawn.y });
}

function hold(store: Store, input: MoveInput, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) tick(store, input);
}

/**
 * Tiene premuto finche' non succede qualcosa, con un tetto di tick.
 *
 * Meglio di un numero fisso di tick: la distanza da percorrere dipende da dove
 * il giocatore si e' fermato, e un test che passa solo con il conteggio giusto
 * si rompe alla prima modifica alla mappa senza dire perche'.
 */
function holdUntil(
  store: Store,
  input: MoveInput,
  done: (state: GameState) => boolean,
  maxTicks: number,
): number {
  for (let i = 1; i <= maxTicks; i += 1) {
    tick(store, input);
    if (done(store.getState())) return i;
  }
  return Number.POSITIVE_INFINITY;
}

let store: Store;

beforeEach(() => {
  store = createStore(newGame(), deps);
});

describe('la partita comincia dove deve', () => {
  it('sulla Costa, di mattina, al primo giorno', () => {
    const state = store.getState();
    expect(state.player.zoneId).toBe('costa');
    expect(state.stats.zonesVisited).toEqual(['costa']);

    const clock = readClock(state.world.gameTimeMs, config.time);
    expect(clock.day).toBe(1);
    expect(clock.hour).toBe(config.time.startHour);
    expect(clock.phase).toBe('day');
  });
});

describe('il tempo scorre con i tick', () => {
  it('avanza di 100ms per tick, e non dipende dal framerate', () => {
    const before = store.getState().world.gameTimeMs;
    hold(store, NO_INPUT, 600); // 60 secondi reali
    const after = store.getState().world.gameTimeMs;
    expect(after - before).toBe(600 * TICK_MS);
  });

  /* 24 minuti reali = un giorno intero (PDR §8, Fase 1). */
  it('un minuto reale vale un ora di gioco', () => {
    const start = readClock(store.getState().world.gameTimeMs, config.time).hour;
    hold(store, NO_INPUT, 600);
    expect(readClock(store.getState().world.gameTimeMs, config.time).hour).toBe(start + 1);
  });

  it('arriva alla notte restando fermi abbastanza a lungo', () => {
    hold(store, NO_INPUT, 14 * 600); // quattordici ore di gioco
    const clock = readClock(store.getState().world.gameTimeMs, config.time);
    expect(clock.hour).toBe(22);
    expect(clock.phase).toBe('night');
  });

  it('conta il tempo giocato', () => {
    hold(store, NO_INPUT, 100);
    expect(store.getState().stats.playtimeMs).toBe(100 * TICK_MS);
  });
});

describe('camminare per il mondo', () => {
  /*
   * IL criterio di accettazione della Fase 1. Dalla spiaggia si tiene premuto
   * "su" e si arriva nel bosco: sentiero percorribile, collisioni che non
   * bloccano la strada, uscita che scatta.
   */
  it('dalla Costa si raggiunge il Bosco tenendo premuto su', () => {
    const ticks = holdUntil(
      store,
      { ...NO_INPUT, up: true },
      (state) => state.player.zoneId === 'bosco',
      200,
    );

    expect(ticks).toBeLessThan(200);
    // Circa sei secondi di cammino: se diventasse molto piu' lungo, il percorso
    // iniziale si sarebbe allungato senza che nessuno se ne accorgesse.
    expect(ticks).toBeLessThan(80);
    expect(store.getState().stats.zonesVisited).toEqual(['costa', 'bosco']);
  });

  it('comparendo nel Bosco non si viene rispediti indietro', () => {
    holdUntil(store, { ...NO_INPUT, up: true }, (s) => s.player.zoneId === 'bosco', 200);
    const arrival = store.getState().player;

    hold(store, NO_INPUT, 20);
    expect(store.getState().player.zoneId).toBe('bosco');
    expect(store.getState().player.y).toBe(arrival.y);
  });

  it('si torna sulla Costa ripercorrendo il sentiero verso sud', () => {
    holdUntil(store, { ...NO_INPUT, up: true }, (s) => s.player.zoneId === 'bosco', 200);
    expect(store.getState().player.zoneId).toBe('bosco');

    const ticks = holdUntil(
      store,
      { ...NO_INPUT, down: true },
      (state) => state.player.zoneId === 'costa',
      300,
    );

    expect(ticks).toBeLessThan(300);
    expect(store.getState().stats.zonesVisited).toEqual(['costa', 'bosco']);
  });

  it('il mare a ovest non si attraversa', () => {
    const before = store.getState().player.x;
    hold(store, { ...NO_INPUT, left: true }, 200);
    const after = store.getState().player.x;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(3 * rules.tileSize); // fermato dalla battigia
    expect(store.getState().player.zoneId).toBe('costa');
  });

  it('la direzione dello sguardo segue il movimento', () => {
    hold(store, { ...NO_INPUT, left: true }, 1);
    expect(store.getState().player.facing).toBe('left');
    hold(store, { ...NO_INPUT, down: true }, 1);
    expect(store.getState().player.facing).toBe('down');
  });
});

describe('riduttore', () => {
  it('registra i flag', () => {
    store.dispatch({ type: 'setFlag', key: 'cartelloLetto', value: true });
    expect(store.getState().flags['cartelloLetto']).toBe(true);
  });

  it('non duplica una zona gia visitata', () => {
    store.dispatch({ type: 'enterZone', zoneId: 'bosco', x: 100, y: 100 });
    store.dispatch({ type: 'enterZone', zoneId: 'costa', x: 100, y: 100 });
    store.dispatch({ type: 'enterZone', zoneId: 'bosco', x: 100, y: 100 });
    expect(store.getState().stats.zonesVisited).toEqual(['costa', 'bosco']);
  });

  it('rifiuta una zona inesistente invece di lasciare il giocatore nel vuoto', () => {
    expect(() => store.dispatch({ type: 'enterZone', zoneId: 'atlantide', x: 0, y: 0 })).toThrow(
      /Zona sconosciuta/,
    );
  });

  it('notifica gli ascoltatori e permette di disiscriversi', () => {
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    tick(store, NO_INPUT);
    expect(calls).toBe(1);
    unsubscribe();
    tick(store, NO_INPUT);
    expect(calls).toBe(1);
  });
});

describe('squadra e deposito', () => {
  function fill(count: number): void {
    for (let i = 0; i < count; i += 1) {
      store.dispatch({ type: 'grantCreature', creature: creature(5), caught: true });
    }
  }

  /*
   * Il criterio di accettazione della Fase 3: catturi dieci Ferali e li ritrovi
   * tutti. Senza deposito la cattura si spegne dopo il terzo.
   */
  it('dieci catture entrano tutte: tre in squadra, sette in deposito', () => {
    fill(10);
    const state = store.getState();
    expect(state.party).toHaveLength(battleConfig.partySize);
    expect(state.storage).toHaveLength(10 - battleConfig.partySize);
    expect(state.stats.creaturesCaught).toBe(10);
    expect(state.archive['dew_sprout']?.caught).toBe(10);
  });

  it('si sposta un Ferale in deposito e lo si riprende', () => {
    fill(4);
    const before = store.getState();
    const uid = before.party[1]?.uid ?? '';

    store.dispatch({ type: 'moveToStorage', uid });
    expect(store.getState().party.map((c) => c.uid)).not.toContain(uid);
    expect(store.getState().storage.map((c) => c.uid)).toContain(uid);

    store.dispatch({ type: 'moveToParty', uid });
    expect(store.getState().party.map((c) => c.uid)).toContain(uid);
  });

  /* Una squadra vuota renderebbe impossibile qualunque scontro successivo. */
  it('non lascia svuotare la squadra', () => {
    store.dispatch({ type: 'grantCreature', creature: creature(5), caught: false });
    const uid = store.getState().party[0]?.uid ?? '';
    store.dispatch({ type: 'moveToStorage', uid });
    expect(store.getState().party).toHaveLength(1);
  });

  it('non fa entrare un quarto Ferale in una squadra da tre', () => {
    fill(5);
    const uid = store.getState().storage[0]?.uid ?? '';
    store.dispatch({ type: 'moveToParty', uid });
    expect(store.getState().party).toHaveLength(battleConfig.partySize);
    expect(store.getState().storage.map((c) => c.uid)).toContain(uid);
  });

  it('riordina la squadra: l ordine decide chi entra per primo', () => {
    fill(3);
    const before = store.getState().party.map((c) => c.uid);
    store.dispatch({ type: 'swapParty', a: 0, b: 2 });
    const after = store.getState().party.map((c) => c.uid);
    expect(after[0]).toBe(before[2]);
    expect(after[2]).toBe(before[0]);
  });

  it('assegna e toglie un soprannome', () => {
    fill(1);
    const uid = store.getState().party[0]?.uid ?? '';

    store.dispatch({ type: 'renameCreature', uid, nickname: '  Foglia  ' });
    expect(store.getState().party[0]?.nickname).toBe('Foglia');

    store.dispatch({ type: 'renameCreature', uid, nickname: '   ' });
    expect(store.getState().party[0]?.nickname).toBeUndefined();
  });
});

describe('oggetti', () => {
  it('una bacca cura, e viene consumata', () => {
    store.dispatch({ type: 'grantCreature', creature: { ...creature(5), hp: 10 }, caught: false });
    const uid = store.getState().party[0]?.uid ?? '';
    const before = store.getState().inventory['bacca_verde'] ?? 0;

    store.dispatch({ type: 'useItem', itemId: 'bacca_verde', uid });

    expect(store.getState().party[0]?.hp).toBeGreaterThan(10);
    expect(store.getState().inventory['bacca_verde']).toBe(before - 1);
  });

  /*
   * Un oggetto che non ha effetto non viene consumato: sprecarlo per una
   * distrazione è frustrazione gratuita, e costa una riga evitarla.
   */
  it('non consuma una bacca su chi è già al massimo', () => {
    store.dispatch({ type: 'grantCreature', creature: creature(5), caught: false });
    const uid = store.getState().party[0]?.uid ?? '';
    const before = store.getState().inventory['bacca_verde'] ?? 0;

    store.dispatch({ type: 'useItem', itemId: 'bacca_verde', uid });
    expect(store.getState().inventory['bacca_verde']).toBe(before);
  });

  it('non usa un oggetto che non si possiede', () => {
    store.dispatch({ type: 'grantCreature', creature: { ...creature(5), hp: 5 }, caught: false });
    const uid = store.getState().party[0]?.uid ?? '';
    store.dispatch({ type: 'useItem', itemId: 'bacca_ambra', uid });
    expect(store.getState().party[0]?.hp).toBe(5);
  });
});

describe('salvare e ricaricare', () => {
  /*
   * "Salvi, ricarichi la pagina e ricompari nella stessa posizione con lo
   * stesso orario di gioco" — il criterio di accettazione, verificato sullo
   * stato invece che a occhio.
   */
  it('riprende dalla stessa posizione e dallo stesso orario', () => {
    hold(store, { ...NO_INPUT, up: true }, 45);
    const saved = store.getState();

    // Ricaricare la pagina = ricostruire lo store dallo stato salvato.
    const reloaded = createStore(saved, deps);
    const state = reloaded.getState();

    expect(state.player).toEqual(saved.player);
    expect(state.world.gameTimeMs).toBe(saved.world.gameTimeMs);
    expect(readClock(state.world.gameTimeMs, config.time)).toEqual(
      readClock(saved.world.gameTimeMs, config.time),
    );
  });

  it('riprende a camminare da dove si era rimasti', () => {
    hold(store, { ...NO_INPUT, up: true }, 45);
    const saved = store.getState();

    const reloaded = createStore(saved, deps);
    hold(reloaded, { ...NO_INPUT, up: true }, 75);

    expect(reloaded.getState().player.zoneId).toBe('bosco');
  });
});
