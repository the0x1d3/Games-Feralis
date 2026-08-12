import { TICK_MS } from '../clock';
import type { CreatureInstance } from '../creature/instance';
import type { Move, Species } from '../creature/species';
import { computeStats } from '../creature/stats';
import { createRng, type RngState } from '../rng';
import { decide, type AiActor, type AiBench, type AiLevel } from './ai';
import { advanceAtb, isReady } from './atb';
import { resolveCapture, resolveFlee, resolveMove, resolveSwitch, settleFaints } from './resolve';
import {
  activeOf,
  isDown,
  type BattleCombatant,
  type BattleContext,
  type BattleState,
  type Side,
} from './state';

/**
 * Macchina a stati del combattimento.
 *
 * Un `tick` vale esattamente 100 ms simulati, lo stesso passo del mondo
 * (PDR §7.1). La barra ATB avanza solo qui, e quando tocca al giocatore la
 * macchina si ferma in `awaitingPlayer` e non consuma altro tempo: è la
 * modalità *wait* dell'errata E4.
 *
 * Lo stato del RNG viaggia **dentro** lo stato del combattimento. Significa che
 * uno scontro è interamente riproducibile dal suo seme, che `balance-sim` può
 * confrontare due run e che i test a seme fisso non sono fragili.
 */

export type BattleAction =
  | { readonly type: 'tick' }
  | { readonly type: 'move'; readonly moveId: string }
  | { readonly type: 'switch'; readonly index: number }
  | { readonly type: 'capture'; readonly toolId: string }
  | { readonly type: 'flee' };

export interface CreateBattleOptions {
  readonly playerTeam: readonly CreatureInstance[];
  readonly enemyTeam: readonly CreatureInstance[];
  readonly aiLevel: AiLevel;
  readonly rngState: RngState;
  /** Chi ha sorpreso chi. Vale solo al primo turno (errata E12). */
  readonly initiativeSide?: Side | undefined;
}

function toCombatant(instance: CreatureInstance, context: BattleContext): BattleCombatant {
  const species = context.species.get(instance.speciesId);
  if (species === undefined) throw new Error(`Specie sconosciuta: "${instance.speciesId}"`);

  const stats = computeStats(
    {
      species,
      level: instance.level,
      ivs: instance.ivs,
      traits: instance.traits,
      isAlpha: instance.isAlpha,
    },
    context.creatures,
  );

  return {
    uid: instance.uid,
    speciesId: instance.speciesId,
    level: instance.level,
    types: species.types,
    stats,
    hp: Math.min(instance.hp, stats.hp),
    moves: instance.moves,
    status: instance.status === undefined ? undefined : { id: instance.status, turnsLeft: 2 },
    atb: 0,
    isAlpha: instance.isAlpha,
    baseCatchRate: speciesCatchRate(species, instance),
  };
}

/** Un Alfa catturato resta Alfa, e resta difficile da catturare (PDR §5.1). */
function speciesCatchRate(species: Species, instance: CreatureInstance): number {
  return instance.isAlpha ? Math.min(species.baseCatchRate, 0.18) : species.baseCatchRate;
}

export function createBattle(options: CreateBattleOptions, context: BattleContext): BattleState {
  if (options.playerTeam.length === 0 || options.enemyTeam.length === 0) {
    throw new Error('Un combattimento richiede almeno un esemplare per lato');
  }

  return {
    phase: 'running',
    player: { members: options.playerTeam.map((c) => toCombatant(c, context)), active: 0 },
    enemy: { members: options.enemyTeam.map((c) => toCombatant(c, context)), active: 0 },
    aiLevel: options.aiLevel,
    elapsedMs: 0,
    turn: 0,
    rngState: options.rngState,
    initiativeSide: options.initiativeSide,
    log: [],
  };
}

function effectiveVel(combatant: BattleCombatant): number {
  return combatant.stats.vel;
}

/**
 * Chi agisce, quando entrambe le barre sono piene.
 *
 * Vince la barra più avanti; a parità, la velocità; a parità ancora, il
 * giocatore. Un pareggio deciso a caso renderebbe irriproducibile il turno.
 */
function readySide(state: BattleState, config: BattleContext['config']): Side | undefined {
  const player = activeOf(state, 'player');
  const enemy = activeOf(state, 'enemy');
  const playerReady = isReady(player.atb, config);
  const enemyReady = isReady(enemy.atb, config);

  if (playerReady && enemyReady) {
    if (player.atb !== enemy.atb) return player.atb > enemy.atb ? 'player' : 'enemy';
    return effectiveVel(player) >= effectiveVel(enemy) ? 'player' : 'enemy';
  }
  if (playerReady) return 'player';
  if (enemyReady) return 'enemy';
  return undefined;
}

function aiTurn(state: BattleState, context: BattleContext, rngState: RngState): BattleState {
  const rng = createRng(rngState);
  const enemy = activeOf(state, 'enemy');
  const player = activeOf(state, 'player');

  const toActor = (combatant: BattleCombatant): AiActor => ({
    level: combatant.level,
    stats: combatant.stats,
    types: combatant.types,
    status: combatant.status,
    hp: combatant.hp,
    moves: combatant.moves
      .map((id) => context.moves.get(id))
      .filter((move): move is Move => move !== undefined),
  });

  const bench: AiBench[] = state.enemy.members
    .map((member, index) => ({ index, member }))
    .filter(({ index, member }) => index !== state.enemy.active && !isDown(member))
    .map(({ index, member }) => ({ index, actor: toActor(member) }));

  const decision = decide(
    state.aiLevel,
    toActor(enemy),
    { level: player.level, stats: player.stats, types: player.types, status: player.status },
    bench,
    context.config,
    rng,
  );

  const acted =
    decision.kind === 'switch'
      ? resolveSwitch(state, 'enemy', decision.index, context)
      : resolveMove(state, 'enemy', decision.moveId, context, rng);

  return { ...acted, rngState: rng.getState() };
}

export function reduceBattle(
  state: BattleState,
  action: BattleAction,
  context: BattleContext,
): BattleState {
  if (state.phase === 'over') return state;

  if (action.type === 'tick') {
    if (state.phase !== 'running') return state;

    const advanced: BattleState = {
      ...state,
      elapsedMs: state.elapsedMs + TICK_MS,
      player: {
        ...state.player,
        members: state.player.members.map((member, index) =>
          index === state.player.active
            ? {
                ...member,
                atb: advanceAtb(member.atb, member.stats.vel, member.status, context.config),
              }
            : member,
        ),
      },
      enemy: {
        ...state.enemy,
        members: state.enemy.members.map((member, index) =>
          index === state.enemy.active
            ? {
                ...member,
                atb: advanceAtb(member.atb, member.stats.vel, member.status, context.config),
              }
            : member,
        ),
      },
    };

    const ready = readySide(advanced, context.config);
    if (ready === undefined) return advanced;
    if (ready === 'player') return { ...advanced, phase: 'awaitingPlayer' };
    return settleFaints(aiTurn(advanced, context, advanced.rngState));
  }

  if (state.phase !== 'awaitingPlayer') return state;

  const rng = createRng(state.rngState);
  const running: BattleState = { ...state, phase: 'running' };

  switch (action.type) {
    case 'move':
      return {
        ...resolveMove(running, 'player', action.moveId, context, rng),
        rngState: rng.getState(),
      };
    case 'switch':
      return resolveSwitch(running, 'player', action.index, context);
    case 'capture':
      return { ...resolveCapture(running, action.toolId, context, rng), rngState: rng.getState() };
    case 'flee':
      return { ...resolveFlee(running, context, rng), rngState: rng.getState() };
  }
}

/** Fa avanzare la simulazione finché non serve il giocatore o non finisce. */
export function runUntilInput(
  state: BattleState,
  context: BattleContext,
  maxTicks = 20_000,
): BattleState {
  let current = state;
  for (let i = 0; i < maxTicks && current.phase === 'running'; i += 1) {
    current = reduceBattle(current, { type: 'tick' }, context);
  }
  return current;
}
