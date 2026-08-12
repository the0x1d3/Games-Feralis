import { totemStructure } from '@domain/base/config';
import { canPlace, demolish, place } from '@domain/base/layout';
import { produce, type Worker } from '@domain/base/production';
import { structureAt, type BaseState } from '@domain/base/state';
import { assign, canAssign, unassign, workLevelOf } from '@domain/base/workers';
import { findInRoster } from '@domain/creature/roster';
import { applyLossFraction } from '@domain/economy/inventory';
import { phaseAt, readClock } from '@domain/world/time';
import { rosterOf, type GameState } from './gameState';
import type { ReducerDeps } from './store';

/**
 * Le azioni della Radura, staccate dal riduttore principale.
 *
 * Stanno in un file loro perche' `store.ts` aveva superato le 300 righe
 * (CLAUDE.md, regola 8) e perche' sono un blocco coerente: piantare, costruire,
 * assegnare, recuperare il tempo passato.
 *
 * Come tutto il resto del riduttore, qui non si calcola nulla: si chiamano le
 * funzioni di `domain/base/` e si mette via il risultato.
 */

export type BaseAction =
  | {
      readonly type: 'plantTotem';
      readonly zoneId: string;
      readonly tx: number;
      readonly ty: number;
    }
  | {
      readonly type: 'build';
      readonly structureId: string;
      readonly tx: number;
      readonly ty: number;
    }
  | { readonly type: 'demolish'; readonly id: string }
  | { readonly type: 'assignWorker'; readonly structureId: string; readonly uid: string }
  | { readonly type: 'unassignWorker'; readonly structureId: string }
  /**
   * Il recupero offline: Radura e orologio avanzano insieme.
   *
   * Insieme e non in due azioni, perche' fra le due la scena disegnerebbe una
   * Radura che ha prodotto otto ore con un orologio fermo all'ora del
   * salvataggio.
   */
  | { readonly type: 'applyOffline'; readonly base: BaseState; readonly gameTimeMs: number }
  /** Il prezzo di un KO: una frazione dello zaino, mai il deposito (PDR §4.6). */
  | { readonly type: 'loseOnDefeat' };

/**
 * I lavoratori assegnati, con il livello nella mansione della loro struttura.
 *
 * Si ricalcola a ogni tick invece di tenerlo nello stato: il livello dipende
 * dalla specie e puo' cambiare con un'evoluzione, e una copia nello stato
 * sarebbe una seconda verita' da tenere allineata.
 */
export function workersOf(state: GameState, deps: ReducerDeps): Map<string, Worker> {
  const workers = new Map<string, Worker>();

  for (const structure of state.base.structures) {
    if (structure.workerUid === undefined) continue;
    const creature = findInRoster(rosterOf(state), structure.workerUid);
    const def = deps.structureDefs.get(structure.structureId);
    const species = creature === undefined ? undefined : deps.species.get(creature.speciesId);
    if (creature === undefined || species === undefined || def === undefined) continue;

    workers.set(creature.uid, {
      uid: creature.uid,
      workLevel: workLevelOf(species, def.work),
      nocturnal: creature.traits.includes('notturno'),
    });
  }

  return workers;
}

/**
 * Un tick di produzione.
 *
 * E' la stessa `produce` che gira offline, chiamata con un tick invece che con
 * un segmento omogeneo (ADR 0002). Online gli ingredienti si possono consumare:
 * la catena miniera → fornace ha senso solo mentre qualcuno la guarda.
 */
export function tickBase(
  state: GameState,
  deltaMs: number,
  gameTimeMs: number,
  deps: ReducerDeps,
): BaseState {
  const isNight =
    phaseAt(readClock(gameTimeMs, deps.config.time).hourFloat, deps.config.time) === 'night';

  return produce(
    state.base,
    deltaMs,
    { config: deps.baseConfig, structures: deps.structureDefs, workers: workersOf(state, deps) },
    { isNight, allowInputs: true },
  ).base;
}

export function reduceBase(state: GameState, action: BaseAction, deps: ReducerDeps): GameState {
  switch (action.type) {
    case 'plantTotem': {
      // Un Totem solo: le basi multiple sono un moltiplicatore di bug
      // (PDR, Appendice A punto 5) e restano fuori dall'MVP.
      if (state.base.totem !== undefined) return state;

      const def = totemStructure(deps.structureDefs);
      const zone = deps.zones.get(action.zoneId);
      if (def === undefined || zone === undefined) return state;

      // Anche il Totem risponde al terreno: piantato dentro uno scoglio
      // renderebbe irraggiungibile il centro della propria Radura.
      const check = canPlace(def, action.tx, action.ty, {
        base: state.base,
        structures: deps.structureDefs,
        config: deps.baseConfig,
        grid: zone.collision,
        zoneId: action.zoneId,
      });
      if (!check.ok) return state;

      // Il Totem e' anche una struttura piazzata: cosi' occupa spazio sulla
      // griglia e si disegna come tutte le altre, invece di essere un caso
      // speciale in ogni funzione che scorre la Radura.
      const withTotem = place(state.base, def, action.tx, action.ty).base;
      return {
        ...state,
        base: { ...withTotem, totem: { zoneId: action.zoneId, tx: action.tx, ty: action.ty } },
      };
    }

    case 'build': {
      const def = deps.structureDefs.get(action.structureId);
      const zone = deps.zones.get(state.player.zoneId);
      if (def === undefined || zone === undefined) return state;

      const check = canPlace(def, action.tx, action.ty, {
        base: state.base,
        structures: deps.structureDefs,
        config: deps.baseConfig,
        grid: zone.collision,
        zoneId: state.player.zoneId,
      });
      if (!check.ok) return state;

      return { ...state, base: place(state.base, def, action.tx, action.ty).base };
    }

    case 'demolish': {
      // Il Totem non si smonta: senza, la Radura resterebbe rivendicata da un
      // centro che non c'e' piu' e le strutture rimaste sarebbero orfane.
      const placed = structureAt(state.base, action.id);
      if (placed === undefined) return state;
      if (deps.structureDefs.get(placed.structureId)?.kind === 'totem') return state;

      return { ...state, base: demolish(state.base, deps.structureDefs, action.id) };
    }

    case 'assignWorker': {
      const creature = findInRoster(rosterOf(state), action.uid);
      const species = creature === undefined ? undefined : deps.species.get(creature.speciesId);
      if (creature === undefined || species === undefined) return state;

      const check = canAssign(
        state.base,
        action.structureId,
        creature,
        species,
        deps.structureDefs,
      );
      if (!check.ok) return state;

      return { ...state, base: assign(state.base, action.structureId, action.uid) };
    }

    case 'unassignWorker':
      return { ...state, base: unassign(state.base, action.structureId) };

    case 'applyOffline':
      return { ...state, base: action.base, world: { gameTimeMs: action.gameTimeMs } };

    case 'loseOnDefeat': {
      const loss = applyLossFraction(
        state.inventory,
        deps.baseConfig.defeat.inventoryLossFraction,
      );
      // `base.resources` non compare qui apposta: il deposito della Radura non
      // si tocca mai (E8). Si perde quel che si portava addosso.
      return { ...state, inventory: loss.inventory };
    }
  }
}
