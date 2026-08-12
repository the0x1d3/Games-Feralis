import { describe, expect, it } from 'vitest';
import { createRng } from '@domain/rng';
import { SCHEMA_VERSION, type GameState } from '@state/gameState';
import { createRngRuntime } from '@state/rngRuntime';
import { deserialize, fromExportCode, readGameState, serialize, toExportCode } from './codec';

const SAVE: GameState = {
  schemaVersion: SCHEMA_VERSION,
  gameVersion: '0.2.0',
  createdAt: 1_700_000_000_000,
  lastSavedAt: 1_700_000_060_000,
  rngStreams: { world: 111, battle: 222, loot: 333, breeding: 444 },
  player: { zoneId: 'bosco', x: 624.5, y: 880.25, facing: 'left' },
  world: { gameTimeMs: 1_234_567 },
  party: [
    {
      uid: 'abc123def456',
      speciesId: 'dew_sprout',
      nickname: 'Foglia',
      level: 7,
      xp: 120,
      ivs: { hp: 20, att: 3, dif: 31, vel: 12, ele: 8, res: 25 },
      traits: ['robusto'],
      hp: 311,
      status: 'burned',
      moves: ['colpo', 'rampicante', 'spora'],
      isAlpha: false,
      morale: 88,
      caughtAt: 1_700_000_010_000,
    },
  ],
  archive: { dew_sprout: { seen: true, caught: 1 }, tide_fin: { seen: true, caught: 0 } },
  inventory: { nodo_base: 8, nodo_migliorato: 2 },
  flags: { hoLettoIlCartello: true },
  stats: {
    playtimeMs: 60_000,
    zonesVisited: ['costa', 'bosco'],
    battlesWon: 2,
    creaturesCaught: 1,
  },
};

describe('serialize / deserialize', () => {
  it('fa un giro completo senza perdere nulla', () => {
    expect(deserialize(serialize(SAVE))).toEqual(SAVE);
  });

  it('conserva le posizioni con la virgola', () => {
    const back = deserialize(serialize(SAVE));
    expect(back.player.x).toBe(624.5);
    expect(back.player.y).toBe(880.25);
  });
});

describe('readGameState', () => {
  it('pretende i campi senza cui la partita non esiste', () => {
    expect(() => readGameState({})).toThrow();
    expect(() => readGameState({ player: { zoneId: 'costa' } })).toThrow(/player\.x/);
  });

  /*
   * Tollerante sul resto: un salvataggio recuperato a meta' vale infinitamente
   * piu' di uno rifiutato (PDR §7.4).
   */
  it('inventa un default ragionevole per tutto il resto', () => {
    const minimal = readGameState({ player: { zoneId: 'costa', x: 10, y: 20 } });
    expect(minimal.player.facing).toBe('down');
    expect(minimal.world.gameTimeMs).toBe(0);
    expect(minimal.flags).toEqual({});
    expect(minimal.stats.zonesVisited).toEqual([]);
    expect(minimal.rngStreams.world).toBe(0);
  });

  it('scarta una direzione senza senso invece di propagarla', () => {
    const state = readGameState({ player: { zoneId: 'costa', x: 0, y: 0, facing: 'diagonale' } });
    expect(state.player.facing).toBe('down');
  });

  it('ignora i flag che non sono booleani', () => {
    const state = readGameState({
      player: { zoneId: 'costa', x: 0, y: 0 },
      flags: { buono: true, sospetto: 'forse' },
    });
    expect(state.flags).toEqual({ buono: true });
  });
});

describe('continuita del RNG attraverso il salvataggio', () => {
  /*
   * IL test del buco E6. Senza lo stato degli stream nel salvataggio, ogni
   * ricarica farebbe rivedere al giocatore la stessa sequenza di esiti.
   */
  it('riprende la sequenza da dove era stata salvata, non dall inizio', () => {
    const runtime = createRngRuntime(SAVE.rngStreams);
    const battle = runtime.stream('battle');
    for (let i = 0; i < 7; i += 1) battle.next();

    // Si salva DOPO le sette estrazioni e PRIMA di leggere il seguito, come fa
    // la sessione vera quando l'autosalvataggio scatta a meta' partita.
    const saved = deserialize(serialize({ ...SAVE, rngStreams: runtime.snapshot() }));

    const expected = Array.from({ length: 5 }, () => battle.next());
    const resumed = createRngRuntime(saved.rngStreams).stream('battle');
    const actual = Array.from({ length: 5 }, () => resumed.next());

    expect(actual).toEqual(expected);
  });

  it('ripartendo dal seme originale invece darebbe una sequenza diversa', () => {
    const fresh = createRng(SAVE.rngStreams.battle);
    const runtime = createRngRuntime(SAVE.rngStreams);
    const battle = runtime.stream('battle');
    for (let i = 0; i < 7; i += 1) battle.next();

    expect(battle.next()).not.toBe(fresh.next());
  });
});

describe('codice di esportazione', () => {
  it('fa un giro completo', async () => {
    const code = await toExportCode(SAVE);
    expect(code.startsWith('FRL1.')).toBe(true);
    expect(await fromExportCode(code)).toEqual(SAVE);
  });

  it('sopravvive a spazi incollati per sbaglio', async () => {
    const code = await toExportCode(SAVE);
    expect(await fromExportCode(`  ${code}\n`)).toEqual(SAVE);
  });

  it('rifiuta un codice troncato invece di caricare spazzatura', async () => {
    const code = await toExportCode(SAVE);
    const truncated = code.slice(0, Math.floor(code.length * 0.8));
    await expect(fromExportCode(truncated)).rejects.toThrow();
  });

  it('rifiuta un codice con il checksum sbagliato', async () => {
    const code = await toExportCode(SAVE);
    const parts = code.split('.');
    parts[3] = 'deadbeef';
    await expect(fromExportCode(parts.join('.'))).rejects.toThrow(/corrotto/);
  });

  it('rifiuta qualcosa che non e un codice di Feralis', async () => {
    await expect(fromExportCode('ciao come stai')).rejects.toThrow(/non sembra/);
  });

  it('comprime davvero: il codice e piu corto del JSON', async () => {
    const code = await toExportCode(SAVE);
    expect(code.split('.')[1]).toBe('z');
    expect(code.length).toBeLessThan(serialize(SAVE).length);
  });
});
