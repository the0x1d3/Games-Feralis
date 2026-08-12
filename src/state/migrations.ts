import { SCHEMA_VERSION } from './gameState';

/**
 * Migrazioni dei salvataggi.
 *
 * Oggi la tabella e' vuota: lo schema 1 e' il primo che sia mai esistito. Il
 * meccanismo pero' c'e' gia', ed e' testato, perche' il momento in cui serve e'
 * anche il momento in cui non si ha tempo di progettarlo: si sta pubblicando
 * un aggiornamento e ci sono partite vere da non rompere.
 *
 * Come si aggiunge una migrazione:
 *  1. si incrementa SCHEMA_VERSION in gameState.ts;
 *  2. si aggiunge qui la funzione con chiave = versione DI PARTENZA;
 *  3. si aggiunge un test che carica un salvataggio della versione vecchia
 *     e verifica che arrivi intero (CLAUDE.md, regola 5).
 *
 * Una migrazione non deve mai lanciare per un campo mancante: deve inventare
 * un default ragionevole. Un salvataggio recuperato a meta' vale
 * infinitamente piu' di un salvataggio rifiutato.
 */

export type RawSave = Record<string, unknown>;

/** Trasforma un salvataggio dalla versione `chiave` alla successiva. */
export type Migration = (save: RawSave) => RawSave;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  /**
   * 1 → 2 (Fase 2): arrivano squadra, archivio delle specie e inventario.
   *
   * La squadra resta **vuota**: il Ferale iniziale non viene creato qui, perché
   * una migrazione è una funzione pura che non ha accesso né alle specie né al
   * RNG. Se ne occupa la sessione, con la stessa regola che vale per una
   * partita nuova ("se la squadra è vuota, ricevi il Ferale iniziale") — così
   * esiste un percorso solo, ed è quello già testato.
   */
  1: (save) => ({
    ...save,
    party: [],
    archive: {},
    inventory: { nodo_base: 10, nodo_migliorato: 2 },
    stats: {
      ...(typeof save['stats'] === 'object' && save['stats'] !== null ? save['stats'] : {}),
      battlesWon: 0,
      creaturesCaught: 0,
    },
  }),

  /**
   * 2 → 3 (Fase 3): arriva il deposito.
   *
   * Chi giocava alla Fase 2 aveva al massimo tre Ferali, tutti in squadra:
   * il deposito nasce vuoto e non c'è nulla da spostare.
   */
  2: (save) => ({ ...save, storage: [] }),
};

export interface MigrationResult {
  readonly save: RawSave;
  readonly from: number;
  readonly to: number;
  readonly applied: number;
}

export function readSchemaVersion(save: RawSave): number {
  const value = save['schemaVersion'];
  // Un salvataggio senza versione puo' solo venire da prima che esistessero:
  // lo si tratta come schema 1 invece di buttarlo.
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

/**
 * Porta un salvataggio alla versione corrente applicando le migrazioni in
 * catena. La tabella e' un parametro cosi' i test possono verificare il
 * meccanismo senza inventare migrazioni finte dentro il codice di produzione.
 */
export function migrate(
  save: RawSave,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): MigrationResult {
  const from = readSchemaVersion(save);

  if (from > target) {
    throw new Error(
      `Questo salvataggio viene da una versione piu' recente del gioco (schema ${from}, qui si arriva a ${target}). Aggiorna la pagina.`,
    );
  }

  let current = save;
  let version = from;
  let applied = 0;

  while (version < target) {
    const step = migrations[version];
    if (step === undefined) {
      throw new Error(`Manca la migrazione dallo schema ${version} al ${version + 1}`);
    }
    current = step(current);
    version += 1;
    applied += 1;
    current = { ...current, schemaVersion: version };
  }

  return { save: current, from, to: version, applied };
}
