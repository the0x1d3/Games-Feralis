import { describe, expect, it } from 'vitest';
import altopianoMap from '@data/maps/altopiano.json';
import boscoMap from '@data/maps/bosco.json';
import costaMap from '@data/maps/costa.json';
import tilesData from '@data/world/tiles.json';
import worldData from '@data/world/world.json';
import { overlapsSolid } from './collision';
import { parseWorldConfig } from './config';
import { reachableTiles } from './reachability';
import { parseTileRules, parseZone } from './tiled';
import { findSpawn, type Zone } from './zone';

/**
 * Verifica il CONTENUTO, non solo il codice.
 *
 * Il criterio di accettazione della Fase 1 e' "cammini per 3 zone". Provarlo a
 * mano dopo ogni modifica alle mappe e' esattamente il genere di controllo che
 * si smette di fare dopo la terza volta, e allora una mappa resta rotta per
 * settimane. Qui il percorso viene verificato staticamente.
 */

const rules = parseTileRules(tilesData);
const config = parseWorldConfig(worldData);

const RAW: Readonly<Record<string, unknown>> = {
  costa: costaMap,
  bosco: boscoMap,
  altopiano: altopianoMap,
};

const zones = new Map<string, Zone>(
  Object.entries(RAW).map(([id, raw]) => [id, parseZone(raw, id, rules)]),
);

const zoneIds = [...zones.keys()];

function zoneOf(id: string): Zone {
  const zone = zones.get(id);
  if (zone === undefined) throw new Error(`zona assente dal test: ${id}`);
  return zone;
}

describe('mappe', () => {
  it('si leggono tutte e tre', () => {
    expect(zoneIds).toEqual(['costa', 'bosco', 'altopiano']);
    for (const zone of zones.values()) {
      expect(zone.width).toBe(40);
      expect(zone.height).toBe(30);
      expect(zone.tileSize).toBe(rules.tileSize);
      expect(zone.layers.ground).toHaveLength(40 * 30);
    }
  });

  it('hanno tutte un fondo disegnato in ogni casella', () => {
    for (const zone of zones.values()) {
      expect(zone.layers.ground.every((tile) => tile >= 0)).toBe(true);
    }
  });

  it('mettono le chiome degli alberi nel layer sopra il giocatore', () => {
    // E' la prova visiva della profondita': ci si cammina sotto.
    const canopies = zoneOf('bosco').layers.over.filter((tile) => tile >= 0);
    expect(canopies.length).toBeGreaterThan(50);
  });
});

describe('punti di comparsa', () => {
  it('sono tutti su terreno calpestabile, con il corpo del giocatore vero', () => {
    for (const zone of zones.values()) {
      for (const object of zone.objects) {
        if (object.kind !== 'spawn') continue;
        expect(
          overlapsSolid(zone.collision, object.x, object.y, config.player.body),
          `${zone.id}/${object.name} finisce dentro un ostacolo`,
        ).toBe(false);
      }
    }
  });

  /*
   * Se si comparisse sopra l'uscita da cui si e' appena arrivati, si verrebbe
   * rispediti indietro all'istante e le due zone diventerebbero una porta
   * girevole.
   */
  it('non stanno sopra un uscita', () => {
    for (const zone of zones.values()) {
      const exits = zone.objects.filter((object) => object.kind === 'exit');
      for (const object of zone.objects) {
        if (object.kind !== 'spawn') continue;
        for (const exit of exits) {
          const inside =
            object.x >= exit.x &&
            object.x < exit.x + exit.width &&
            object.y >= exit.y &&
            object.y < exit.y + exit.height;
          expect(inside, `${zone.id}/${object.name} e sopra un uscita`).toBe(false);
        }
      }
    }
  });
});

describe('uscite', () => {
  it('puntano a zone e comparse che esistono davvero', () => {
    for (const zone of zones.values()) {
      for (const object of zone.objects) {
        if (object.kind !== 'exit') continue;
        const destination = zones.get(object.toZone);
        expect(destination, `${zone.id} → zona "${object.toZone}" inesistente`).toBeDefined();
        if (destination !== undefined) {
          expect(() => findSpawn(destination, object.toSpawn)).not.toThrow();
        }
      }
    }
  });

  it('sono raggiungibili a piedi dal punto di comparsa della loro zona', () => {
    for (const zone of zones.values()) {
      const entry = zone.objects.find((object) => object.kind === 'spawn');
      expect(entry, `${zone.id} non ha punti di comparsa`).toBeDefined();
      if (entry === undefined) continue;

      const reachable = reachableTiles(zone.collision, {
        tx: Math.floor(entry.x / zone.tileSize),
        ty: Math.floor(entry.y / zone.tileSize),
      });

      for (const object of zone.objects) {
        if (object.kind !== 'exit') continue;
        const tx = Math.floor(object.x / zone.tileSize);
        const ty = Math.floor(object.y / zone.tileSize);
        expect(
          reachable.has(ty * zone.width + tx),
          `${zone.id}: l'uscita verso ${object.toZone} non e raggiungibile a piedi`,
        ).toBe(true);
      }
    }
  });
});

describe('cartelli', () => {
  it('hanno una casella libera da cui leggerli', () => {
    for (const zone of zones.values()) {
      for (const object of zone.objects) {
        if (object.kind !== 'sign') continue;
        const tx = Math.floor(object.x / zone.tileSize);
        const ty = Math.floor(object.y / zone.tileSize);
        const neighbours = [
          [tx + 1, ty],
          [tx - 1, ty],
          [tx, ty + 1],
          [tx, ty - 1],
        ] as const;
        const free = neighbours.some(([nx, ny]) => {
          const index = ny * zone.width + nx;
          return (
            nx >= 0 &&
            ny >= 0 &&
            nx < zone.width &&
            ny < zone.height &&
            zone.collision.solid[index] === 0
          );
        });
        expect(free, `${zone.id}: cartello in (${tx}, ${ty}) circondato da ostacoli`).toBe(true);
      }
    }
  });
});

describe('il mondo e connesso', () => {
  /*
   * IL test della Fase 1: partendo dove comincia la partita si deve poter
   * raggiungere ogni zona, attraversando solo uscite realmente calpestabili.
   */
  it('permette di raggiungere tutte e tre le zone dall inizio della partita', () => {
    const visited = new Set<string>([config.startZoneId]);
    const queue = [{ zoneId: config.startZoneId, spawn: config.startSpawn }];

    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined) break;

      const zone = zoneOf(current.zoneId);
      const spawn = findSpawn(zone, current.spawn);
      const reachable = reachableTiles(zone.collision, {
        tx: Math.floor(spawn.x / zone.tileSize),
        ty: Math.floor(spawn.y / zone.tileSize),
      });

      for (const object of zone.objects) {
        if (object.kind !== 'exit') continue;
        const tx = Math.floor(object.x / zone.tileSize);
        const ty = Math.floor(object.y / zone.tileSize);
        if (!reachable.has(ty * zone.width + tx)) continue;
        if (visited.has(object.toZone)) continue;
        visited.add(object.toZone);
        queue.push({ zoneId: object.toZone, spawn: object.toSpawn });
      }
    }

    expect([...visited].sort()).toEqual([...zoneIds].sort());
  });
});
