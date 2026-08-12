import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, readSchemaVersion, type Migration, type RawSave } from './migrations';
import { SCHEMA_VERSION } from './gameState';

/**
 * Il meccanismo delle migrazioni si verifica con una catena finta, non con
 * migrazioni inventate dentro il codice di produzione: quando servira' la
 * prima vera, l'infrastruttura sara' gia' provata.
 */

const FAKE_CHAIN: Readonly<Record<number, Migration>> = {
  1: (save) => ({ ...save, aggiuntoInV2: true }),
  2: (save) => ({ ...save, aggiuntoInV3: 'ciao' }),
};

describe('readSchemaVersion', () => {
  it('legge la versione dichiarata', () => {
    expect(readSchemaVersion({ schemaVersion: 4 })).toBe(4);
  });

  /*
   * Un salvataggio senza versione puo' solo venire da prima che esistessero.
   * Trattarlo come schema 1 e' l'unico modo di non buttarlo via.
   */
  it('tratta un salvataggio senza versione come schema 1', () => {
    expect(readSchemaVersion({})).toBe(1);
    expect(readSchemaVersion({ schemaVersion: 'due' })).toBe(1);
    expect(readSchemaVersion({ schemaVersion: -3 })).toBe(1);
  });
});

describe('migrate', () => {
  it('applica la catena in ordine e aggiorna la versione', () => {
    const result = migrate({ schemaVersion: 1, dati: 'intatti' }, FAKE_CHAIN, 3);

    expect(result.from).toBe(1);
    expect(result.to).toBe(3);
    expect(result.applied).toBe(2);
    expect(result.save['schemaVersion']).toBe(3);
    expect(result.save['aggiuntoInV2']).toBe(true);
    expect(result.save['aggiuntoInV3']).toBe('ciao');
  });

  it('non tocca i dati gia aggiornati', () => {
    const save: RawSave = { schemaVersion: 3, dati: 'intatti' };
    const result = migrate(save, FAKE_CHAIN, 3);
    expect(result.applied).toBe(0);
    expect(result.save).toEqual(save);
  });

  it('conserva i campi che la migrazione non tocca', () => {
    const result = migrate({ schemaVersion: 1, player: { x: 10 } }, FAKE_CHAIN, 3);
    expect(result.save['player']).toEqual({ x: 10 });
  });

  it('parte da meta catena se il salvataggio e gia parziale', () => {
    const result = migrate({ schemaVersion: 2 }, FAKE_CHAIN, 3);
    expect(result.applied).toBe(1);
    expect(result.save['aggiuntoInV2']).toBeUndefined();
    expect(result.save['aggiuntoInV3']).toBe('ciao');
  });

  it('segnala con chiarezza una migrazione mancante invece di corrompere', () => {
    expect(() => migrate({ schemaVersion: 1 }, {}, 2)).toThrow(/Manca la migrazione/);
  });

  /*
   * Un salvataggio dal futuro capita a chi tiene due schede aperte durante un
   * aggiornamento. Meglio un messaggio comprensibile che una partita letta a
   * meta' e risalvata rovinata.
   */
  it('rifiuta un salvataggio piu recente del gioco', () => {
    expect(() => migrate({ schemaVersion: 99 }, FAKE_CHAIN, 3)).toThrow(/piu' recente/);
  });
});

describe('la tabella reale', () => {
  it('copre ogni passo fino alla versione corrente', () => {
    for (let version = 1; version < SCHEMA_VERSION; version += 1) {
      expect(MIGRATIONS[version], `manca la migrazione da ${version}`).toBeTypeOf('function');
    }
  });
});

/**
 * Un salvataggio vero della Fase 1, come lo scriveva il gioco allora.
 *
 * È il test che CLAUDE.md (regola 5) pretende a ogni cambio di schema: carica
 * un vecchio salvataggio e verifica che arrivi intero. La promessa del PDR
 * §6.4 — "un salvataggio non deve mai essere invalidato da un update" — vale
 * solo finché questo test esiste.
 */
const SAVE_V1: RawSave = {
  schemaVersion: 1,
  gameVersion: '0.2.0',
  createdAt: 1_700_000_000_000,
  lastSavedAt: 1_700_000_600_000,
  rngStreams: { world: 12345, battle: 6789, loot: 111, breeding: 222 },
  player: { zoneId: 'bosco', x: 624, y: 463.36, facing: 'right' },
  world: { gameTimeMs: 490_100 },
  flags: { hoLettoIlCartello: true },
  stats: { playtimeMs: 610_000, zonesVisited: ['costa', 'bosco'] },
};

describe('dalla Fase 1 alla Fase 2 (schema 1 → 2)', () => {
  const migrated = migrate(SAVE_V1);

  it('arriva alla versione corrente', () => {
    expect(migrated.from).toBe(1);
    expect(migrated.to).toBe(SCHEMA_VERSION);
    expect(migrated.applied).toBe(SCHEMA_VERSION - 1);
  });

  it('non perde nulla di quello che c era', () => {
    expect(migrated.save['player']).toEqual(SAVE_V1['player']);
    expect(migrated.save['world']).toEqual(SAVE_V1['world']);
    expect(migrated.save['rngStreams']).toEqual(SAVE_V1['rngStreams']);
    expect(migrated.save['flags']).toEqual(SAVE_V1['flags']);
    expect(migrated.save['createdAt']).toBe(SAVE_V1['createdAt']);
  });

  it('conserva le statistiche già accumulate e aggiunge le nuove', () => {
    expect(migrated.save['stats']).toEqual({
      playtimeMs: 610_000,
      zonesVisited: ['costa', 'bosco'],
      battlesWon: 0,
      creaturesCaught: 0,
    });
  });

  it('aggiunge squadra, archivio e inventario', () => {
    expect(migrated.save['party']).toEqual([]);
    expect(migrated.save['archive']).toEqual({});
    expect(migrated.save['inventory']).toEqual({ nodo_base: 10, nodo_migliorato: 2 });
  });

  /*
   * La squadra resta vuota di proposito: il Ferale iniziale lo consegna la
   * sessione, con la stessa regola che vale per una partita nuova. Una
   * migrazione è pura e non ha accesso né alle specie né al RNG.
   */
  it('lascia la squadra vuota, che è il segnale per il regalo iniziale', () => {
    expect(migrated.save['party']).toEqual([]);
  });

  it('è idempotente: rimigrare un salvataggio già aggiornato non lo tocca', () => {
    expect(migrate(migrated.save).applied).toBe(0);
    expect(migrate(migrated.save).save).toEqual(migrated.save);
  });

  it('regge un salvataggio v1 monco senza buttarlo', () => {
    const partial = migrate({ schemaVersion: 1, player: { zoneId: 'costa', x: 1, y: 2 } });
    expect(partial.save['party']).toEqual([]);
    expect(partial.save['stats']).toEqual({ battlesWon: 0, creaturesCaught: 0 });
  });
});
