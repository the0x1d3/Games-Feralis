import { describe, expect, it } from 'vitest';
import creatureData from '@data/creatures.json';
import dewSprout from '@data/species/dew_sprout.json';
import { createRng } from '../rng';
import { createCreature, type CreatureInstance } from './instance';
import {
  admit,
  findInRoster,
  MAX_NICKNAME_LENGTH,
  moveToParty,
  moveToStorage,
  rename,
  replaceCreature,
  rosterSize,
  swapParty,
  type Roster,
} from './roster';
import { parseSpecies } from './species';
import { parseCreatureConfig } from './stats';

const config = parseCreatureConfig(creatureData);
const species = parseSpecies(dewSprout, 'dew_sprout');

const PARTY_SIZE = 3;

function creature(seed: number): CreatureInstance {
  return createCreature(
    { species, level: 5, isAlpha: false, caughtAt: 0 },
    config,
    createRng(seed * 7919),
  );
}

function roster(partyCount: number, storageCount = 0): Roster {
  return {
    party: Array.from({ length: partyCount }, (_, i) => creature(i + 1)),
    storage: Array.from({ length: storageCount }, (_, i) => creature(100 + i)),
  };
}

describe('admit', () => {
  it('mette in squadra finché c è posto', () => {
    const result = admit(roster(1), creature(50), PARTY_SIZE);
    expect(result.party).toHaveLength(2);
    expect(result.storage).toHaveLength(0);
  });

  /* Catturare non deve mai essere un'azione che non produce nulla. */
  it('manda in deposito quando la squadra è piena', () => {
    const result = admit(roster(PARTY_SIZE), creature(50), PARTY_SIZE);
    expect(result.party).toHaveLength(PARTY_SIZE);
    expect(result.storage).toHaveLength(1);
  });
});

describe('spostamenti', () => {
  it('la squadra non resta mai vuota', () => {
    const single = roster(1);
    const uid = single.party[0]?.uid ?? '';
    const result = moveToStorage(single, uid);
    expect(result.changed).toBe(false);
    expect(result.roster.party).toHaveLength(1);
  });

  it('la squadra non supera la dimensione dichiarata', () => {
    const full = roster(PARTY_SIZE, 2);
    const uid = full.storage[0]?.uid ?? '';
    expect(moveToParty(full, uid, PARTY_SIZE).changed).toBe(false);
  });

  it('un uid inesistente non cambia nulla', () => {
    const base = roster(2, 1);
    expect(moveToStorage(base, 'fantasma').changed).toBe(false);
    expect(moveToParty(base, 'fantasma', PARTY_SIZE).changed).toBe(false);
    expect(rename(base, 'fantasma', 'Nome').changed).toBe(false);
  });

  it('non perde nessuno spostando avanti e indietro', () => {
    const base = roster(3, 1);
    const uid = base.party[2]?.uid ?? '';
    const toStorage = moveToStorage(base, uid).roster;
    const back = moveToParty(toStorage, uid, PARTY_SIZE).roster;

    expect(rosterSize(back)).toBe(rosterSize(base));
    expect(findInRoster(back, uid)).toBeDefined();
  });
});

describe('swapParty', () => {
  it('scambia due posti', () => {
    const base = roster(3);
    const result = swapParty(base, 0, 2);
    expect(result.changed).toBe(true);
    expect(result.roster.party[0]?.uid).toBe(base.party[2]?.uid);
    expect(result.roster.party[2]?.uid).toBe(base.party[0]?.uid);
  });

  it('ignora indici uguali o fuori squadra', () => {
    const base = roster(2);
    expect(swapParty(base, 1, 1).changed).toBe(false);
    expect(swapParty(base, 0, 5).changed).toBe(false);
  });
});

describe('rename', () => {
  it('assegna e taglia alla lunghezza massima', () => {
    const base = roster(1);
    const uid = base.party[0]?.uid ?? '';
    const long = 'x'.repeat(MAX_NICKNAME_LENGTH + 10);
    const result = rename(base, uid, long);
    expect(result.roster.party[0]?.nickname).toHaveLength(MAX_NICKNAME_LENGTH);
  });

  it('un nome di soli spazi toglie il soprannome invece di metterne uno invisibile', () => {
    const base = roster(1);
    const uid = base.party[0]?.uid ?? '';
    const named = rename(base, uid, 'Foglia').roster;
    expect(named.party[0]?.nickname).toBe('Foglia');
    expect(rename(named, uid, '   ').roster.party[0]?.nickname).toBeUndefined();
  });

  it('rinomina anche chi sta in deposito', () => {
    const base = roster(1, 1);
    const uid = base.storage[0]?.uid ?? '';
    expect(rename(base, uid, 'Sasso').roster.storage[0]?.nickname).toBe('Sasso');
  });
});

describe('replaceCreature', () => {
  it('sostituisce ovunque si trovi', () => {
    const base = roster(2, 2);
    const target = base.storage[1];
    expect(target).toBeDefined();
    if (target === undefined) return;

    const levelled = { ...target, level: 20 };
    const result = replaceCreature(base, levelled);
    expect(result.storage[1]?.level).toBe(20);
    expect(rosterSize(result)).toBe(rosterSize(base));
  });
});
