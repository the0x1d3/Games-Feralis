/**
 * Lettura difensiva di dati esterni.
 *
 * I file di `/data` sono validati in CI (ADR 0003), quindi qui non serve un
 * validatore completo: servono messaggi che dicano *quale* campo manca, invece
 * di un "undefined is not an object" tre stack frame piu' in la'.
 *
 * `unknown` in ingresso e non `any`: e' la differenza fra un confine e un buco.
 */

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${what}: atteso un oggetto`);
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${what}: atteso un array`);
  return value;
}

export function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${what}: atteso un numero finito`);
  }
  return value;
}

export function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new TypeError(`${what}: attesa una stringa`);
  return value;
}

/** Colore esadecimale "#rrggbb" verso il numero che si passa a Phaser. */
export function asColor(value: unknown, what: string): number {
  const text = asString(value, what);
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) {
    throw new TypeError(`${what}: atteso un colore nella forma "#rrggbb", ricevuto "${text}"`);
  }
  return Number.parseInt(text.slice(1), 16);
}
