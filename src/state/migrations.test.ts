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
