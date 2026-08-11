import { describe, expect, it } from 'vitest';
import costaMap from '@data/maps/costa.json';
import tilesData from '@data/world/tiles.json';
import { exitUnder, facingSign, signAt, tileInFront } from './interaction';
import type { Actor } from './movement';
import { parseTileRules, parseZone } from './tiled';
import { findSpawn, type Facing } from './zone';

const rules = parseTileRules(tilesData);
const costa = parseZone(costaMap, 'costa', rules);
const TILE = costa.tileSize;

function actorAtTile(tx: number, ty: number, facing: Facing): Actor {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, facing, moving: false };
}

/** Il cartello della spiaggia, piazzato in data/maps/costa.json. */
const BEACH_SIGN = { tx: 17, ty: 20 };

describe('tileInFront', () => {
  it('guarda la casella nella direzione dello sguardo', () => {
    expect(tileInFront(actorAtTile(5, 5, 'up'), TILE)).toEqual({ tx: 5, ty: 4 });
    expect(tileInFront(actorAtTile(5, 5, 'down'), TILE)).toEqual({ tx: 5, ty: 6 });
    expect(tileInFront(actorAtTile(5, 5, 'left'), TILE)).toEqual({ tx: 4, ty: 5 });
    expect(tileInFront(actorAtTile(5, 5, 'right'), TILE)).toEqual({ tx: 6, ty: 5 });
  });

  it('non dipende da dove ci si trova dentro la casella', () => {
    const angolo: Actor = { x: 5 * TILE + 1, y: 5 * TILE + 31, facing: 'right', moving: false };
    expect(tileInFront(angolo, TILE)).toEqual({ tx: 6, ty: 5 });
  });
});

describe('cartelli', () => {
  it('trova il cartello della spiaggia alla sua casella', () => {
    expect(signAt(costa, BEACH_SIGN)?.textKey).toBe('world.sign.beach');
  });

  it('non trova nulla su una casella qualsiasi', () => {
    expect(signAt(costa, { tx: 2, ty: 2 })).toBeUndefined();
  });

  it('si legge stando davanti e guardandolo', () => {
    const davanti = actorAtTile(BEACH_SIGN.tx, BEACH_SIGN.ty + 1, 'up');
    expect(facingSign(costa, davanti)?.textKey).toBe('world.sign.beach');
  });

  /*
   * Guardare da un'altra parte non deve leggere il cartello: l'interazione e'
   * direzionale, altrimenti passandoci accanto si aprirebbe da sola.
   */
  it('non si legge dandogli le spalle', () => {
    const spalle = actorAtTile(BEACH_SIGN.tx, BEACH_SIGN.ty + 1, 'down');
    expect(facingSign(costa, spalle)).toBeUndefined();
  });

  it('non si legge stando lontani', () => {
    const lontano = actorAtTile(BEACH_SIGN.tx, BEACH_SIGN.ty + 4, 'up');
    expect(facingSign(costa, lontano)).toBeUndefined();
  });

  it('si legge da qualsiasi lato, purche rivolti verso di lui', () => {
    expect(facingSign(costa, actorAtTile(BEACH_SIGN.tx - 1, BEACH_SIGN.ty, 'right'))?.textKey).toBe(
      'world.sign.beach',
    );
    expect(facingSign(costa, actorAtTile(BEACH_SIGN.tx + 1, BEACH_SIGN.ty, 'left'))?.textKey).toBe(
      'world.sign.beach',
    );
  });
});

describe('uscite', () => {
  it('scattano stando sopra il rettangolo', () => {
    const sulBordo = actorAtTile(19, 0, 'up');
    const exit = exitUnder(costa, sulBordo);
    expect(exit?.toZone).toBe('bosco');
    expect(exit?.toSpawn).toBe('from_costa');
  });

  it('non scattano dalla casella accanto', () => {
    expect(exitUnder(costa, actorAtTile(19, 1, 'up'))).toBeUndefined();
    expect(exitUnder(costa, actorAtTile(17, 0, 'up'))).toBeUndefined();
  });

  /*
   * Si controlla il punto centrale e non il rettangolo del corpo: sfiorare
   * l'uscita con uno spigolo camminando lungo il bordo non deve teletrasportare.
   */
  it('non scattano sfiorando il rettangolo con lo spigolo del corpo', () => {
    const accanto: Actor = { x: 18 * TILE - 4, y: 16, facing: 'up', moving: false };
    expect(exitUnder(costa, accanto)).toBeUndefined();
  });

  it('il punto di comparsa iniziale non e sopra un uscita', () => {
    const spawn = findSpawn(costa, 'start');
    expect(
      exitUnder(costa, { x: spawn.x, y: spawn.y, facing: 'down', moving: false }),
    ).toBeUndefined();
  });
});
