import type { CreatureInstance } from './instance';

/**
 * Squadra e deposito.
 *
 * Il deposito esiste perché la squadra è di tre (PDR §5.2) ma catturare è il
 * motore del gioco: senza un posto dove mettere il quarto Ferale, la cattura
 * si spegne dopo dieci minuti.
 *
 * Due invarianti, e sono entrambe protette qui e non nella UI:
 *  - la squadra non resta mai vuota, o non si potrebbe più combattere;
 *  - la squadra non supera mai la dimensione dichiarata in `battle.json`.
 */

export interface Roster {
  readonly party: readonly CreatureInstance[];
  readonly storage: readonly CreatureInstance[];
}

export interface RosterChange {
  readonly roster: Roster;
  readonly changed: boolean;
}

function unchanged(roster: Roster): RosterChange {
  return { roster, changed: false };
}

export function findInRoster(roster: Roster, uid: string): CreatureInstance | undefined {
  return [...roster.party, ...roster.storage].find((entry) => entry.uid === uid);
}

export function rosterSize(roster: Roster): number {
  return roster.party.length + roster.storage.length;
}

/** Accoglie un nuovo esemplare: in squadra se c'è posto, altrimenti in deposito. */
export function admit(roster: Roster, creature: CreatureInstance, partySize: number): Roster {
  if (roster.party.length < partySize) {
    return { ...roster, party: [...roster.party, creature] };
  }
  return { ...roster, storage: [...roster.storage, creature] };
}

export function moveToStorage(roster: Roster, uid: string): RosterChange {
  const index = roster.party.findIndex((entry) => entry.uid === uid);
  if (index < 0) return unchanged(roster);

  // Svuotare la squadra renderebbe impossibile qualunque scontro successivo.
  if (roster.party.length <= 1) return unchanged(roster);

  const creature = roster.party[index];
  if (creature === undefined) return unchanged(roster);

  return {
    roster: {
      party: roster.party.filter((_, i) => i !== index),
      storage: [...roster.storage, creature],
    },
    changed: true,
  };
}

export function moveToParty(roster: Roster, uid: string, partySize: number): RosterChange {
  if (roster.party.length >= partySize) return unchanged(roster);

  const index = roster.storage.findIndex((entry) => entry.uid === uid);
  if (index < 0) return unchanged(roster);

  const creature = roster.storage[index];
  if (creature === undefined) return unchanged(roster);

  return {
    roster: {
      party: [...roster.party, creature],
      storage: roster.storage.filter((_, i) => i !== index),
    },
    changed: true,
  };
}

/**
 * Scambia due posti in squadra.
 *
 * L'ordine conta: il primo è quello che entra in campo per primo, quindi
 * riordinare è una decisione tattica, non estetica.
 */
export function swapParty(roster: Roster, a: number, b: number): RosterChange {
  const first = roster.party[a];
  const second = roster.party[b];
  if (a === b || first === undefined || second === undefined) return unchanged(roster);

  const party = [...roster.party];
  party[a] = second;
  party[b] = first;
  return { roster: { ...roster, party }, changed: true };
}

export const MAX_NICKNAME_LENGTH = 16;

/**
 * Rinomina un esemplare.
 *
 * Un nome vuoto o fatto di soli spazi rimuove il soprannome invece di
 * impostarne uno invisibile.
 */
export function rename(roster: Roster, uid: string, nickname: string): RosterChange {
  const clean = nickname.trim().slice(0, MAX_NICKNAME_LENGTH);

  const apply = (list: readonly CreatureInstance[]): CreatureInstance[] =>
    list.map((entry) => {
      if (entry.uid !== uid) return entry;
      const { nickname: _scarta, ...rest } = entry;
      return clean === '' ? rest : { ...rest, nickname: clean };
    });

  if (findInRoster(roster, uid) === undefined) return unchanged(roster);
  return { roster: { party: apply(roster.party), storage: apply(roster.storage) }, changed: true };
}

/** Sostituisce un esemplare ovunque si trovi, per livello, cure ed evoluzioni. */
export function replaceCreature(roster: Roster, creature: CreatureInstance): Roster {
  const swap = (list: readonly CreatureInstance[]): CreatureInstance[] =>
    list.map((entry) => (entry.uid === creature.uid ? creature : entry));
  return { party: swap(roster.party), storage: swap(roster.storage) };
}
