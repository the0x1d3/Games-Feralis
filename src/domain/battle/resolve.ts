import type { Rng } from '../rng';
import { attemptCapture } from './capture';
import { computeDamage } from './damage';
import { resolveItemEffect } from '../economy/items';
import {
  applyStatus,
  decayStatus,
  preventsSwitch,
  skipsTurn,
  speedMultiplier,
  statusDamage,
} from './status';
import {
  activeOf,
  isDown,
  log,
  nextStanding,
  opposite,
  replaceMember,
  requireMove,
  teamOf,
  updateActive,
  withTeam,
  type BattleContext,
  type BattleState,
  type Side,
} from './state';

/**
 * Risoluzione di un turno.
 *
 * Ogni funzione prende lo stato e restituisce lo stato nuovo: nessuna muta il
 * proprio ingresso. Il RNG arriva da fuori, e chi chiama è responsabile di
 * rimettere la sua posizione nello stato — è così che un combattimento resta
 * riproducibile da un seme.
 */

function combatantView(state: BattleState, side: Side): Parameters<typeof computeDamage>[0] {
  const active = activeOf(state, side);
  return { level: active.level, stats: active.stats, types: active.types, status: active.status };
}

/** Azzera la barra di chi ha appena agito. Nessuno agisce due volte di fila. */
function spendTurn(state: BattleState, side: Side): BattleState {
  return updateActive(state, side, (member) => ({ ...member, atb: 0 }));
}

/**
 * Fine turno di chi ha agito: danno da stato e conto alla rovescia.
 *
 * Il danno da stato colpisce chi lo subisce alla fine del **proprio** turno,
 * non a ogni tick: legato ai turni resta prevedibile, legato al tempo
 * penalizzerebbe chi è lento due volte.
 */
function endOfTurn(state: BattleState, side: Side, context: BattleContext): BattleState {
  const active = activeOf(state, side);
  if (active.status === undefined) return state;

  const damage = statusDamage(active.status, active.stats.hp, context.config);
  const next = decayStatus(active.status);

  let result = updateActive(state, side, (member) => ({
    ...member,
    hp: Math.max(0, member.hp - damage),
    status: next,
  }));

  if (damage > 0) result = log(result, { kind: 'statusDamage', side, amount: damage });
  if (next === undefined) {
    result = log(result, { kind: 'statusEnded', side, statusId: active.status.id });
  }
  if (isDown(activeOf(result, side))) result = log(result, { kind: 'faint', side });

  return result;
}

/** Dopo un KO: cambio automatico, o fine del combattimento. */
export function settleFaints(state: BattleState): BattleState {
  let result = state;

  for (const side of ['player', 'enemy'] as const) {
    const team = teamOf(result, side);
    const active = team.members[team.active];
    if (active === undefined || !isDown(active)) continue;

    const replacement = nextStanding(team);
    if (replacement !== undefined) {
      result = withTeam(result, side, { ...team, active: replacement });
      result = log(result, { kind: 'switch', side, index: replacement });
      continue;
    }

    const outcome = side === 'player' ? 'lost' : 'won';
    return log({ ...result, phase: 'over', outcome }, { kind: 'outcome', outcome });
  }

  return result;
}

export function resolveMove(
  state: BattleState,
  side: Side,
  moveId: string,
  context: BattleContext,
  rng: Rng,
): BattleState {
  const attacker = activeOf(state, side);
  const defenderSide = opposite(side);

  if (skipsTurn(attacker.status, context.config)) {
    const stunned = log(state, { kind: 'stunned', side });
    return endOfTurn(spendTurn(stunned, side), side, context);
  }

  const move = requireMove(context, moveId);
  if (!attacker.moves.includes(moveId)) {
    throw new Error(`"${attacker.speciesId}" non conosce la mossa "${moveId}"`);
  }

  const hasInitiative = state.turn === 0 && state.initiativeSide === side;
  const result = computeDamage(
    combatantView(state, side),
    combatantView(state, defenderSide),
    move,
    { hasInitiative },
    context.config,
    rng,
  );

  let next = log(state, {
    kind: 'move',
    side,
    moveId,
    missed: result.missed,
    damage: result.damage,
    crit: result.crit,
    effectiveness: result.effectiveness,
  });

  if (!result.missed) {
    next = updateActive(next, defenderSide, (member) => ({
      ...member,
      hp: Math.max(0, member.hp - result.damage),
    }));

    const defender = activeOf(next, defenderSide);

    // Lo stato non si applica a un bersaglio già a terra: sarebbe rumore nel
    // registro e complicherebbe il cambio automatico.
    if (move.inflicts !== undefined && !isDown(defender) && rng.chance(move.inflicts.chance)) {
      const applied = applyStatus(defender.status, move.inflicts.status, context.config, rng);
      if (applied !== undefined && defender.status === undefined) {
        next = updateActive(next, defenderSide, (member) => ({ ...member, status: applied }));
        next = log(next, {
          kind: 'statusApplied',
          side: defenderSide,
          statusId: move.inflicts.status,
        });
      }
    }

    if (isDown(activeOf(next, defenderSide))) {
      next = log(next, { kind: 'faint', side: defenderSide });
    }
  }

  next = endOfTurn(spendTurn(next, side), side, context);
  return settleFaints({ ...next, turn: next.turn + 1 });
}

export function resolveSwitch(
  state: BattleState,
  side: Side,
  index: number,
  context: BattleContext,
): BattleState {
  const team = teamOf(state, side);
  const active = team.members[team.active];
  const target = team.members[index];

  if (active !== undefined && preventsSwitch(active.status, context.config)) {
    return log(state, { kind: 'switchBlocked', side });
  }
  if (target === undefined || isDown(target) || index === team.active) {
    return log(state, { kind: 'switchBlocked', side });
  }

  // Il cambio costa il turno: entrare gratis renderebbe ogni matchup sfavorevole
  // una formalità, e il triangolo dei tipi smetterebbe di pesare.
  const swapped = withTeam(spendTurn(state, side), side, {
    ...replaceMember(team, team.active, (member) => ({ ...member, atb: 0 })),
    active: index,
  });

  return { ...log(swapped, { kind: 'switch', side, index }), turn: swapped.turn + 1 };
}

export function resolveCapture(
  state: BattleState,
  toolId: string,
  context: BattleContext,
  rng: Rng,
): BattleState {
  const tool = context.config.tools.find((entry) => entry.id === toolId);
  if (tool === undefined) throw new Error(`Nodo sconosciuto: "${toolId}"`);

  const target = activeOf(state, 'enemy');
  const attempt = attemptCapture(
    {
      hp: target.hp,
      maxHp: target.stats.hp,
      level: target.level,
      baseCatchRate: target.baseCatchRate,
      status: target.status,
    },
    tool,
    { teamLevel: context.teamLevel, isNight: context.isNight },
    context.config,
    rng,
  );

  const next = log(state, {
    kind: 'capture',
    captured: attempt.captured,
    chance: attempt.chance,
    shakes: attempt.shakes,
  });

  if (attempt.captured) {
    return log(
      { ...next, phase: 'over', outcome: 'captured', capturedUid: target.uid },
      { kind: 'outcome', outcome: 'captured' },
    );
  }

  // Il tentativo costa il turno anche quando fallisce: senza costo, tentare
  // sarebbe sempre la mossa migliore e la cattura smetterebbe di essere un puzzle.
  return { ...spendTurn(next, 'player'), turn: next.turn + 1 };
}

/**
 * Usa un consumabile su un membro della squadra.
 *
 * Costa il turno, come la cattura: curarsi gratis renderebbe ogni scontro una
 * gara di scorte invece che di scelte. Se l'oggetto non ha effetto il turno
 * **non** si perde, e chi chiama non lo consuma.
 */
export function resolveItem(
  state: BattleState,
  itemId: string,
  targetIndex: number,
  context: BattleContext,
): BattleState {
  const item = context.items.get(itemId);
  const team = state.player;
  const target = team.members[targetIndex];

  if (item === undefined || !item.usableInBattle || target === undefined) {
    return log(state, { kind: 'item', itemId, targetIndex, applied: false });
  }

  const effect = resolveItemEffect(item, {
    hp: target.hp,
    maxHp: target.stats.hp,
    hasStatus: target.status !== undefined,
  });

  if (!effect.applied) {
    return log(state, { kind: 'item', itemId, targetIndex, applied: false });
  }

  const updated = withTeam(
    state,
    'player',
    replaceMember(team, targetIndex, (member) => ({
      ...member,
      hp: effect.hp ?? member.hp,
      status: effect.clearStatus === true ? undefined : member.status,
    })),
  );

  const next = log(updated, { kind: 'item', itemId, targetIndex, applied: true });
  return { ...spendTurn(next, 'player'), turn: next.turn + 1 };
}

export function resolveFlee(state: BattleState, context: BattleContext, rng: Rng): BattleState {
  const player = activeOf(state, 'player');
  const enemy = activeOf(state, 'enemy');
  const { baseChance, speedScale, maxChance } = context.config.flee;

  const playerSpeed = player.stats.vel * speedMultiplier(player.status, context.config);
  const enemySpeed = Math.max(1, enemy.stats.vel * speedMultiplier(enemy.status, context.config));
  const chance = Math.min(maxChance, baseChance + speedScale * (playerSpeed / enemySpeed - 1));

  const success = rng.chance(chance);
  const next = log(state, { kind: 'flee', success });

  if (success) {
    return log({ ...next, phase: 'over', outcome: 'fled' }, { kind: 'outcome', outcome: 'fled' });
  }
  return { ...spendTurn(next, 'player'), turn: next.turn + 1 };
}
