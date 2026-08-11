/**
 * Guardia sui contenuti di /data. Gira in CI: un JSON malformato non arriva in
 * produzione, e il merge si blocca prima.
 *
 * In Fase 0 esistono solo i file di lingua, quindi controlla:
 *  1. che ogni file locale sia un dizionario piatto chiave -> stringa non vuota;
 *  2. che IT ed EN abbiano ESATTAMENTE le stesse chiavi (il PDR promette due
 *     lingue dal day one: una chiave che esiste solo in italiano e' un buco che
 *     si scopre in produzione, in inglese, davanti a un tester);
 *  3. che ogni chiave usata da `t('...')` nel codice esista davvero.
 *
 * Nelle fasi successive qui si aggiungono species, moves, items, structures,
 * recipes e tech, con i controlli di integrita' referenziale fra gli id.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const LOCALES_DIR = join(ROOT, 'data', 'locales');
const SRC_DIR = join(ROOT, 'src');

/** Riferimento: l'italiano definisce l'insieme delle chiavi valide. */
const REFERENCE_LOCALE = 'it';

const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

const localeFileSchema = z.record(
  z
    .string()
    .regex(KEY_PATTERN, 'le chiavi devono essere piatte e in notazione punto, es. "boot.hint"'),
  z.string().min(1, 'nessuna traduzione vuota'),
);

const errors: string[] = [];
const warnings: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

function warn(message: string): void {
  warnings.push(message);
}

function listFiles(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listFiles(full, extension));
    } else if (entry.endsWith(extension)) {
      found.push(full);
    }
  }
  return found;
}

// ---------------------------------------------------------------- 1. Schema

const bundles = new Map<string, Record<string, string>>();

for (const file of listFiles(LOCALES_DIR, '.json')) {
  const name = relative(LOCALES_DIR, file).replace(/\.json$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${name}.json non e' JSON valido: ${(error as Error).message}`);
    continue;
  }

  const parsed = localeFileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fail(`${name}.json → ${issue.path.join('.') || '(radice)'}: ${issue.message}`);
    }
    continue;
  }
  bundles.set(name, parsed.data);
}

// -------------------------------------------------------------- 2. Parita'

const reference = bundles.get(REFERENCE_LOCALE);

if (reference === undefined) {
  fail(`manca data/locales/${REFERENCE_LOCALE}.json, che e' la lingua di riferimento`);
} else {
  const referenceKeys = new Set(Object.keys(reference));

  for (const [name, bundle] of bundles) {
    if (name === REFERENCE_LOCALE) continue;
    const keys = new Set(Object.keys(bundle));

    for (const key of referenceKeys) {
      if (!keys.has(key))
        fail(`${name}.json: manca la chiave "${key}" presente in ${REFERENCE_LOCALE}.json`);
    }
    for (const key of keys) {
      if (!referenceKeys.has(key))
        fail(`${name}.json: chiave "${key}" assente da ${REFERENCE_LOCALE}.json`);
    }
  }

  // ------------------------------------------------------------ 3. Uso reale

  const used = new Set<string>();
  const callPattern = /\bt\(\s*['"]([^'"]+)['"]/g;

  for (const file of listFiles(SRC_DIR, '.ts')) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(callPattern)) {
      const key = match[1];
      if (key === undefined) continue;
      used.add(key);
      if (!referenceKeys.has(key)) {
        fail(`${relative(ROOT, file)}: t("${key}") non esiste in ${REFERENCE_LOCALE}.json`);
      }
    }
  }

  for (const key of referenceKeys) {
    if (!used.has(key)) warn(`chiave "${key}" definita ma mai usata da un t() letterale`);
  }
}

// ----------------------------------------------------------------- Rapporto

for (const message of warnings) console.warn(`  avviso  ${message}`);

if (errors.length > 0) {
  console.error(`\nvalidate:data — ${errors.length} errore/i\n`);
  for (const message of errors) console.error(`  errore  ${message}`);
  console.error('');
  process.exit(1);
}

const total = [...bundles.values()].reduce((sum, bundle) => sum + Object.keys(bundle).length, 0);
console.log(
  `validate:data — ok: ${bundles.size} file di lingua, ${total} traduzioni, ${warnings.length} avviso/i`,
);
