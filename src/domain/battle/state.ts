import type { ElementType, Move, Species, StatBlock, StatusId } from '../creature/species';
import type { CreatureConfig } from '../creature/stats';
import type { ItemDef } from '../economy/items';
import type { RngState } from '../rng';
import type { AiLevel } from './ai';
import type { BattleConfig } from './config';
import type { ActiveStatus } from './status';

/** Stato di un combattimento. Puro, serializzabile, riproducibile da un seme. */

export type Side = 'player' | 'enemy';

export type BattleOutcome = 'won' | 'lost' | 'captured' | 'fled';

export interface BattleCombatant {
  readonly uid: string;
  readonly speciesId: string;
  readonly level: number;
  readonly types: readonly ElementType[];
  /** Statistiche massime, già calcolate da specie, livello, IV, tratti e Alfa. */
  readonly stats: StatBlock;
  readonly hp: number;
  readonly moves: readonly string[];
  readonly status?: ActiveStatus | undefined;
  readonly atb: number;
  readonly isAlpha: boolean;
  readonly baseCatchRate: number;
}

export interface BattleTeam {
  readonly members: readonly BattleCombatant[];
  readonly active: number;
}

export type BattleEvent =
  | {
      readonly kind: 'move';
      readonly side: Side;
      readonly moveId: string;
      readonly missed: boolean;
      readonly damage: number;
      readonly crit: boolean;
      readonly effectiveness: number;
    }
  | { readonly kind: 'statusApplied'; readonly side: Side; readonly statusId: StatusId }
  | { readonly kind: 'statusDamage'; readonly side: Side; readonly amount: number }
  | { readonly kind: 'statusEnded'; readonly side: Side; readonly statusId: StatusId }
  | { readonly kind: 'stunned'; readonly side: Side }
  | { readonly kind: 'switch'; readonly side: Side; readonly index: number }
  | { readonly kind: 'switchBlocked'; readonly side: Side }
  | {
      readonly kind: 'capture';
      readonly captured: boolean;
      readonly chance: number;
      readonly shakes: number;
    }
  | {
      readonly kind: 'item';
      readonly itemId: string;
      readonly targetIndex: number;
      readonly applied: boolean;
    }
  | { readonly kind: 'flee'; readonly success: boolean }
  | { readonly kind: 'faint'; readonly side: Side }
  | { readonly kind: 'outcome'; readonly outcome: BattleOutcome };

export type BattlePhase = 'running' | 'awaitingPlayer' | 'over';

export interface BattleState {
  readonly phase: BattlePhase;
  readonly outcome?: BattleOutcome;
  readonly player: BattleTeam;
  readonly enemy: BattleTeam;
  readonly aiLevel: AiLevel;
  /** Tempo simulato, in millisecondi: è la durata che `balance-sim` misura. */
  readonly elapsedMs: number;
  readonly turn: number;
  readonly rngState: RngState;
  /** Chi ha il bonus sorpresa, valido solo al primo turno (errata E12). */
  readonly initiativeSide?: Side | undefined;
  readonly log: readonly BattleEvent[];
  /** Uid dell'esemplare catturato, quando l'esito è `captured`. */
  readonly capturedUid?: string | undefined;
}

/** Contenuto immutabile a cui il riduttore attinge. */
export interface BattleContext {
  readonly config: BattleConfig;
  readonly creatures: CreatureConfig;
  readonly moves: ReadonlyMap<string, Move>;
  readonly species: ReadonlyMap<string, Species>;
  readonly items: ReadonlyMap<string, ItemDef>;
  readonly isNight: boolean;
  /** Livello medio della squadra del giocatore, per la formula di cattura. */
  readonly teamLevel: number;
}

export function teamOf(state: BattleState, side: Side): BattleTeam {
  return side === 'player' ? state.player : state.enemy;
}

export function activeOf(state: BattleState, side: Side): BattleCombatant {
  const team = teamOf(state, side);
  const member = team.members[team.active];
  if (member === undefined) throw new Error(`Squadra "${side}" senza esemplare attivo`);
  return member;
}

export function opposite(side: Side): Side {
  return side === 'player' ? 'enemy' : 'player';
}

export function isDown(combatant: BattleCombatant): boolean {
  return combatant.hp <= 0;
}

export function hasStanding(team: BattleTeam): boolean {
  return team.members.some((member) => !isDown(member));
}

/** Primo esemplare in piedi diverso da quello attivo: serve al cambio forzato. */
export function nextStanding(team: BattleTeam): number | undefined {
  for (let i = 0; i < team.members.length; i += 1) {
    const member = team.members[i];
    if (i !== team.active && member !== undefined && !isDown(member)) return i;
  }
  return undefined;
}

export function withTeam(state: BattleState, side: Side, team: BattleTeam): BattleState {
  return side === 'player' ? { ...state, player: team } : { ...state, enemy: team };
}

export function replaceMember(
  team: BattleTeam,
  index: number,
  update: (member: BattleCombatant) => BattleCombatant,
): BattleTeam {
  return {
    ...team,
    members: team.members.map((member, i) => (i === index ? update(member) : member)),
  };
}

export function updateActive(
  state: BattleState,
  side: Side,
  update: (member: BattleCombatant) => BattleCombatant,
): BattleState {
  const team = teamOf(state, side);
  return withTeam(state, side, replaceMember(team, team.active, update));
}

export function log(state: BattleState, ...events: readonly BattleEvent[]): BattleState {
  return { ...state, log: [...state.log, ...events] };
}

export function requireMove(context: BattleContext, moveId: string): Move {
  const move = context.moves.get(moveId);
  if (move === undefined) throw new Error(`Mossa sconosciuta: "${moveId}"`);
  return move;
}
