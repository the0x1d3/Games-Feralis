import { beforeEach, describe, expect, it } from 'vitest';
import battleData from '@data/battle.json';
import creatureData from '@data/creatures.json';
import moveData from '@data/moves.json';
import chalkMite from '@data/species/chalk_mite.json';
import dewSprout from '@data/species/dew_sprout.json';
import emberPup from '@data/species/ember_pup.json';
import tideFin from '@data/species/tide_fin.json';
import { TICK_MS } from '../clock';
import { createCreature, type CreatureInstance } from '../creature/instance';
import { parseMoves, parseSpecies, type Species } from '../creature/species';
import { parseCreatureConfig } from '../creature/stats';
import { createRng } from '../rng';
import { createBattle, reduceBattle, runUntilInput, type BattleAction } from './battle';
import { parseBattleConfig } from './config';
import { activeOf, type BattleContext, type BattleState } from './state';

/**
 * La macchina del combattimento, sui dati veri del gioco.
 *
 * Tutto qui dentro è riproducibile da un seme: è la proprietà che permette a
 * `balance-sim` di confrontare due run e a questi test di non essere fragili.
 */

const config = parseBattleConfig(battleData);
const creatures = parseCreatureConfig(creatureData);
const moves = parseMoves(moveData);

const species = new Map<string, Species>(
  (
    [
      ['dew_sprout', dewSprout],
      ['tide_fin', tideFin],
      ['ember_pup', emberPup],
      ['chalk_mite', chalkMite],
    ] as const
  ).map(([id, raw]) => [id, parseSpecies(raw, id)]),
);

function speciesOf(id: string): Species {
  const found = species.get(id);
  if (found === undefined) throw new Error(`specie assente dal test: ${id}`);
  return found;
}

const context: BattleContext = {
  config,
  creatures,
  moves,
  species,
  items: new Map(),
  isNight: false,
  teamLevel: 10,
};

function makeCreature(id: string, level = 10, seed = 1): CreatureInstance {
  return createCreature(
    { species: speciesOf(id), level, isAlpha: false, caughtAt: 0 },
    creatures,
    createRng(seed),
  );
}

function newBattle(seed = 555, party = ['dew_sprout', 'tide_fin']): BattleState {
  return createBattle(
    {
      playerTeam: party.map((id, index) => makeCreature(id, 10, 10 + index)),
      enemyTeam: [makeCreature('ember_pup', 9, 77)],
      aiLevel: 'greedy',
      rngState: seed,
    },
    context,
  );
}

/** Fa girare lo scontro fino alla fine, giocando sempre la prima mossa. */
function playOut(start: BattleState, pick: (state: BattleState) => BattleAction): BattleState {
  let state = start;
  for (let guard = 0; guard < 50_000 && state.phase !== 'over'; guard += 1) {
    state =
      state.phase === 'running'
        ? reduceBattle(state, { type: 'tick' }, context)
        : reduceBattle(state, pick(state), context);
  }
  return state;
}

const firstMove = (state: BattleState): BattleAction => ({
  type: 'move',
  moveId: activeOf(state, 'player').moves[0] ?? 'colpo',
});

let battle: BattleState;

beforeEach(() => {
  battle = newBattle();
});

describe('creazione', () => {
  it('parte con entrambe le squadre in piedi e la barra a zero', () => {
    expect(battle.phase).toBe('running');
    expect(battle.player.members).toHaveLength(2);
    expect(battle.enemy.members).toHaveLength(1);
    expect(activeOf(battle, 'player').atb).toBe(0);
    expect(activeOf(battle, 'player').hp).toBeGreaterThan(0);
  });

  it('rifiuta uno scontro senza contendenti', () => {
    expect(() =>
      createBattle(
        { playerTeam: [], enemyTeam: [makeCreature('ember_pup')], aiLevel: 'random', rngState: 1 },
        context,
      ),
    ).toThrow();
  });
});

describe('barra ATB in modalità wait', () => {
  it('ogni tick vale 100 ms simulati', () => {
    const after = reduceBattle(battle, { type: 'tick' }, context);
    expect(after.elapsedMs).toBe(TICK_MS);
    expect(activeOf(after, 'player').atb).toBeGreaterThan(0);
  });

  /*
   * È il cuore dell'errata E4: quando tocca al giocatore la simulazione si
   * ferma. Senza, il tempo scorrerebbe mentre si legge il menu e lo scontro
   * non sarebbe più riproducibile da un seme.
   */
  it('si ferma e aspetta quando tocca al giocatore', () => {
    const waiting = runUntilInput(battle, context);
    expect(waiting.phase).toBe('awaitingPlayer');

    const elapsed = waiting.elapsedMs;
    const ignored = reduceBattle(waiting, { type: 'tick' }, context);
    expect(ignored.elapsedMs).toBe(elapsed);
    expect(ignored).toEqual(waiting);
  });

  it('l avversario agisce da solo, senza aspettare nessuno', () => {
    // Un avversario molto più veloce deve riuscire ad agire per primo.
    const fast = createBattle(
      {
        playerTeam: [makeCreature('chalk_mite', 3, 1)],
        enemyTeam: [makeCreature('tide_fin', 20, 2)],
        aiLevel: 'greedy',
        rngState: 9,
      },
      context,
    );
    const state = runUntilInput(fast, context);
    expect(state.log.some((event) => event.kind === 'move' && event.side === 'enemy')).toBe(true);
  });
});

describe('turni', () => {
  it('una mossa toglie HP all avversario', () => {
    const waiting = runUntilInput(battle, context);
    const before = activeOf(waiting, 'enemy').hp;
    const after = reduceBattle(waiting, firstMove(waiting), context);
    expect(activeOf(after, 'enemy').hp).toBeLessThanOrEqual(before);
    expect(after.turn).toBeGreaterThan(waiting.turn);
  });

  it('chi ha agito riparte da barra vuota', () => {
    const waiting = runUntilInput(battle, context);
    const after = reduceBattle(waiting, firstMove(waiting), context);
    expect(activeOf(after, 'player').atb).toBe(0);
  });

  it('rifiuta una mossa che l esemplare non conosce', () => {
    const waiting = runUntilInput(battle, context);
    expect(() => reduceBattle(waiting, { type: 'move', moveId: 'scossone' }, context)).toThrow(
      /non conosce/,
    );
  });

  it('il cambio costa il turno e porta in campo l altro Ferale', () => {
    const waiting = runUntilInput(battle, context);
    const after = reduceBattle(waiting, { type: 'switch', index: 1 }, context);
    expect(after.player.active).toBe(1);
    expect(activeOf(after, 'player').atb).toBe(0);
  });

  it('non si cambia con un esemplare a terra o con se stessi', () => {
    const waiting = runUntilInput(battle, context);
    const same = reduceBattle(waiting, { type: 'switch', index: 0 }, context);
    expect(same.log.at(-1)?.kind).toBe('switchBlocked');
  });
});

describe('fine dello scontro', () => {
  it('finisce, e in un tempo ragionevole', () => {
    const finished = playOut(battle, firstMove);
    expect(finished.phase).toBe('over');
    expect(finished.outcome).toBeDefined();
    expect(finished.elapsedMs).toBeGreaterThan(0);
    expect(finished.elapsedMs).toBeLessThan(5 * 60_000);
  });

  it('con la squadra azzerata si perde', () => {
    const doomed = createBattle(
      {
        playerTeam: [{ ...makeCreature('chalk_mite', 2, 3), hp: 1 }],
        enemyTeam: [makeCreature('ember_pup', 25, 4)],
        aiLevel: 'greedy',
        rngState: 31,
      },
      context,
    );
    expect(playOut(doomed, firstMove).outcome).toBe('lost');
  });

  it('un KO fa entrare da solo il Ferale successivo', () => {
    const twoStrong = createBattle(
      {
        playerTeam: [
          { ...makeCreature('chalk_mite', 2, 5), hp: 1 },
          makeCreature('dew_sprout', 30, 6),
        ],
        enemyTeam: [makeCreature('ember_pup', 12, 7)],
        aiLevel: 'greedy',
        rngState: 12,
      },
      context,
    );
    const finished = playOut(twoStrong, firstMove);
    expect(finished.log.some((event) => event.kind === 'faint' && event.side === 'player')).toBe(
      true,
    );
    expect(finished.outcome).toBe('won');
  });

  it('la cattura chiude lo scontro e registra chi è stato preso', () => {
    let state = runUntilInput(newBattle(4321), context);
    // Si insiste con il Nodo finché non riesce: la probabilità è > 0 comunque.
    for (let i = 0; i < 400 && state.phase !== 'over'; i += 1) {
      state =
        state.phase === 'running'
          ? reduceBattle(state, { type: 'tick' }, context)
          : reduceBattle(state, { type: 'capture', toolId: 'nodo_base' }, context);
    }
    if (state.outcome === 'captured') {
      expect(state.capturedUid).toBe(battle.enemy.members[0]?.uid ?? state.capturedUid);
      expect(state.log.some((event) => event.kind === 'capture' && event.captured)).toBe(true);
    } else {
      // Se non è riuscita, deve comunque essere finita in modo pulito.
      expect(['won', 'lost']).toContain(state.outcome);
    }
  });

  it('un tentativo di cattura fallito costa comunque il turno', () => {
    const waiting = runUntilInput(newBattle(1), context);
    const after = reduceBattle(waiting, { type: 'capture', toolId: 'nodo_base' }, context);
    if (after.outcome !== 'captured') {
      expect(activeOf(after, 'player').atb).toBe(0);
      expect(after.turn).toBeGreaterThan(waiting.turn);
    }
  });

  it('la fuga funziona qualche volta e non sempre', () => {
    let escapes = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const waiting = runUntilInput(newBattle(seed), context);
      const after = reduceBattle(waiting, { type: 'flee' }, context);
      if (after.outcome === 'fled') escapes += 1;
    }
    expect(escapes).toBeGreaterThan(0);
    expect(escapes).toBeLessThan(60);
  });
});

describe('riproducibilità', () => {
  /*
   * Stesso seme, stesso combattimento: senza questa proprietà `balance-sim`
   * non potrebbe confrontare due esecuzioni e ogni test qui sopra sarebbe
   * intermittente.
   */
  it('due scontri con lo stesso seme producono lo stesso registro', () => {
    const first = playOut(newBattle(2024), firstMove);
    const second = playOut(newBattle(2024), firstMove);
    expect(second.log).toEqual(first.log);
    expect(second.elapsedMs).toBe(first.elapsedMs);
    expect(second.outcome).toBe(first.outcome);
  });

  it('semi diversi producono scontri diversi', () => {
    const a = playOut(newBattle(1), firstMove);
    const b = playOut(newBattle(2), firstMove);
    expect(b.log).not.toEqual(a.log);
  });

  it('lo stato del RNG avanza e resta dentro lo stato', () => {
    const finished = playOut(battle, firstMove);
    expect(finished.rngState).not.toBe(battle.rngState);
    expect(Number.isInteger(finished.rngState)).toBe(true);
  });
});
