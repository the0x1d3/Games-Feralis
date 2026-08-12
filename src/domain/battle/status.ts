import type { ElementType, StatusId } from '../creature/species';
import type { Rng } from '../rng';
import type { BattleConfig, StatusDef } from './config';

/**
 * Stati alterati.
 *
 * Cinque stati, durata 2–4 turni, nessuno stacking dello stesso stato (PDR
 * §5.2). Il limite è deliberato: uno stato che si può accumulare diventa una
 * strategia unica dominante, e con sei tipi soli non c'è spazio per correggerla.
 */

export interface ActiveStatus {
  readonly id: StatusId;
  readonly turnsLeft: number;
}

export function statusDef(id: StatusId, config: BattleConfig): StatusDef {
  return config.statuses[id];
}

/** Durata estratta all'applicazione, non fissa: rende meno prevedibile lo scambio. */
export function rollStatus(id: StatusId, config: BattleConfig, rng: Rng): ActiveStatus {
  const def = statusDef(id, config);
  return { id, turnsLeft: rng.int(def.minTurns, def.maxTurns) };
}

/**
 * Applica uno stato solo se il bersaglio è libero.
 *
 * Sovrascrivere uno stato attivo con un altro sarebbe peggio che non applicarlo:
 * il giocatore vedrebbe sparire il Bruciato che ha appena piazzato.
 */
export function applyStatus(
  current: ActiveStatus | undefined,
  incoming: StatusId,
  config: BattleConfig,
  rng: Rng,
): ActiveStatus | undefined {
  if (current !== undefined) return current;
  return rollStatus(incoming, config, rng);
}

export function attackMultiplier(status: ActiveStatus | undefined, config: BattleConfig): number {
  if (status === undefined) return 1;
  return statusDef(status.id, config).attMultiplier ?? 1;
}

export function speedMultiplier(status: ActiveStatus | undefined, config: BattleConfig): number {
  if (status === undefined) return 1;
  return statusDef(status.id, config).velMultiplier ?? 1;
}

/**
 * Resistenza contro un tipo specifico.
 *
 * È qui che vive l'errata E3: Bagnato riduce la resistenza al **Fulmine**, non
 * al Fuoco. Un bersaglio bagnato più vulnerabile al fuoco sarebbe
 * controintuitivo, e la leggibilità è il primo pilastro del combattimento.
 */
export function resistanceMultiplier(
  status: ActiveStatus | undefined,
  moveType: ElementType,
  config: BattleConfig,
): number {
  if (status === undefined) return 1;
  return statusDef(status.id, config).resMultiplierAgainst?.[moveType] ?? 1;
}

export function skipsTurn(status: ActiveStatus | undefined, config: BattleConfig): boolean {
  return status !== undefined && statusDef(status.id, config).skipsTurn === true;
}

export function preventsSwitch(status: ActiveStatus | undefined, config: BattleConfig): boolean {
  return status !== undefined && statusDef(status.id, config).preventsSwitch === true;
}

/** Danno da stato a fine turno, in punti vita. */
export function statusDamage(
  status: ActiveStatus | undefined,
  maxHp: number,
  config: BattleConfig,
): number {
  if (status === undefined) return 0;
  const fraction = statusDef(status.id, config).damagePerTurn;
  if (fraction === undefined) return 0;
  return Math.max(1, Math.floor(maxHp * fraction));
}

/** Scala il contatore. Restituisce `undefined` quando lo stato è finito. */
export function decayStatus(status: ActiveStatus | undefined): ActiveStatus | undefined {
  if (status === undefined) return undefined;
  const turnsLeft = status.turnsLeft - 1;
  return turnsLeft <= 0 ? undefined : { id: status.id, turnsLeft };
}
