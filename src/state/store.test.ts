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
import { createNewGame, type GameState } from './gameState';
import { createStore, type Store } from './store';

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
  store = createStore(newGame(), { config, zones });
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
    const reloaded = createStore(saved, { config, zones });
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

    const reloaded = createStore(saved, { config, zones });
    hold(reloaded, { ...NO_INPUT, up: true }, 75);

    expect(reloaded.getState().player.zoneId).toBe('bosco');
  });
});
