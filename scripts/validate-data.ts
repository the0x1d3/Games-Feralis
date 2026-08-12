/**
 * Guardia sui contenuti di /data. Gira in CI: un dato malformato non arriva in
 * produzione, e il merge si blocca prima (PDR §6.3, regola 3).
 *
 * Controlla:
 *  1. che ogni file di lingua sia un dizionario piatto chiave -> stringa;
 *  2. che IT ed EN abbiano ESATTAMENTE le stesse chiavi;
 *  3. che ogni chiave usata da un `t('...')` letterale nel codice esista;
 *  4. che tiles.json e world.json rispettino il loro schema;
 *  5. che le mappe siano coerenti: layer presenti, gid dentro il tileset,
 *     nameKey e textKey tradotti, uscite verso zone e comparse esistenti.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  checkAmbient,
  checkMap,
  mapSchema,
  spawnNames,
  tilesSchema,
  worldSchema,
  type ParsedMap,
} from './lib/dataChecks';
import {
  battleSchema,
  checkContent,
  creaturesSchema,
  encountersSchema,
  movesSchema,
  speciesSchema,
  type ParsedSpecies,
} from './lib/contentChecks';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const LOCALES_DIR = join(ROOT, 'data', 'locales');
const MAPS_DIR = join(ROOT, 'data', 'maps');
const SPECIES_DIR = join(ROOT, 'data', 'species');
const SRC_DIR = join(ROOT, 'src');

const REFERENCE_LOCALE = 'it';
// Segmenti separati da punto. L'underscore è ammesso dentro un segmento perché
// le chiavi di contenuto ricalcano gli id di /data: `species.dew_sprout`.
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/;

const localeFileSchema = z.record(
  z.string().regex(KEY_PATTERN, 'chiavi piatte in notazione punto, es. "hud.zone"'),
  z.string().min(1, 'nessuna traduzione vuota'),
);

const errors: string[] = [];
const warnings: string[] = [];

function listFiles(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...listFiles(full, extension));
    else if (entry.endsWith(extension)) found.push(full);
  }
  return found;
}

function readJson(file: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${label}: non e JSON valido — ${(error as Error).message}`);
    return undefined;
  }
}

function collectIssues(label: string, result: z.ZodSafeParseResult<unknown>): void {
  if (result.success) return;
  for (const issue of result.error.issues) {
    errors.push(`${label} → ${issue.path.join('.') || '(radice)'}: ${issue.message}`);
  }
}

/* ------------------------------------------------------------- 1-2. lingue */

const bundles = new Map<string, Record<string, string>>();

for (const file of listFiles(LOCALES_DIR, '.json')) {
  const name = relative(LOCALES_DIR, file).replace(/\.json$/, '');
  const raw = readJson(file, `${name}.json`);
  if (raw === undefined) continue;

  const parsed = localeFileSchema.safeParse(raw);
  collectIssues(`${name}.json`, parsed);
  if (parsed.success) bundles.set(name, parsed.data);
}

const reference = bundles.get(REFERENCE_LOCALE);
const referenceKeys = new Set(Object.keys(reference ?? {}));

if (reference === undefined) {
  errors.push(`manca data/locales/${REFERENCE_LOCALE}.json, che e la lingua di riferimento`);
} else {
  for (const [name, bundle] of bundles) {
    if (name === REFERENCE_LOCALE) continue;
    const keys = new Set(Object.keys(bundle));
    for (const key of referenceKeys) {
      if (!keys.has(key)) errors.push(`${name}.json: manca la chiave "${key}"`);
    }
    for (const key of keys) {
      if (!referenceKeys.has(key))
        errors.push(`${name}.json: chiave "${key}" assente da ${REFERENCE_LOCALE}.json`);
    }
  }
}

/* ---------------------------------------------------------- 3. uso nel codice */

const usedKeys = new Set<string>();

for (const file of listFiles(SRC_DIR, '.ts')) {
  const source = readFileSync(file, 'utf8');

  // Chiamata diretta: una chiave inesistente qui e' un ERRORE, perche' il
  // giocatore vedrebbe "hud.zone" al posto di "Zona".
  for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
    const key = match[1];
    if (key === undefined) continue;
    usedKeys.add(key);
    if (!referenceKeys.has(key)) {
      errors.push(`${relative(ROOT, file)}: t("${key}") non esiste in ${REFERENCE_LOCALE}.json`);
    }
  }

  // Chiave citata come letterale ma passata a t() tramite una variabile o una
  // tabella di lookup: conta come usata, altrimenti la ricerca delle chiavi
  // morte segnala falsi positivi e si smette di leggerla.
  for (const match of source.matchAll(/['"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)['"]/g)) {
    const key = match[1];
    if (key !== undefined && referenceKeys.has(key)) usedKeys.add(key);
  }

  // Chiave composta da un template, per esempio `status.${id}`: si marca come
  // usata l'intera famiglia. Meno preciso, ma l'alternativa è una lista di
  // avvisi falsi che si smette di leggere.
  for (const match of source.matchAll(/`([a-z][a-zA-Z0-9.]*)\.\$\{/g)) {
    const prefix = match[1];
    if (prefix === undefined) continue;
    for (const key of referenceKeys) {
      if (key.startsWith(`${prefix}.`)) usedKeys.add(key);
    }
  }
}

/* ------------------------------------------------------------ 4. mondo e tile */

const tilesRaw = readJson(join(ROOT, 'data', 'world', 'tiles.json'), 'tiles.json');
const tilesParsed = tilesSchema.safeParse(tilesRaw);
collectIssues('tiles.json', tilesParsed);

const worldRaw = readJson(join(ROOT, 'data', 'world', 'world.json'), 'world.json');
const worldParsed = worldSchema.safeParse(worldRaw);
collectIssues('world.json', worldParsed);

if (worldParsed.success) {
  errors.push(...checkAmbient(worldParsed.data.time.ambient));
}

/* ----------------------------------------------------------------- 5. mappe */

const maps = new Map<string, ParsedMap>();

for (const file of listFiles(MAPS_DIR, '.json')) {
  const id = relative(MAPS_DIR, file).replace(/\.json$/, '');
  const raw = readJson(file, `${id}.json`);
  if (raw === undefined) continue;
  const parsed = mapSchema.safeParse(raw);
  collectIssues(`${id}.json`, parsed);
  if (parsed.success) maps.set(id, parsed.data);
}

if (tilesParsed.success) {
  const knownZones = new Set(maps.keys());
  const spawnsByZone = new Map<string, ReadonlySet<string>>(
    [...maps].map(([id, map]) => [id, spawnNames(map)]),
  );

  for (const [id, map] of maps) {
    errors.push(
      ...checkMap(
        { id, map, tiles: tilesParsed.data, translationKeys: referenceKeys, knownZones },
        spawnsByZone,
      ),
    );
  }

  if (worldParsed.success && !knownZones.has(worldParsed.data.startZoneId)) {
    errors.push(`world.json: la zona iniziale "${worldParsed.data.startZoneId}" non ha una mappa`);
  }
}

/* ------------------------------------------------------------- 6. contenuto */

const movesParsed = movesSchema.safeParse(readJson(join(ROOT, 'data', 'moves.json'), 'moves.json'));
collectIssues('moves.json', movesParsed);

const creaturesParsed = creaturesSchema.safeParse(
  readJson(join(ROOT, 'data', 'creatures.json'), 'creatures.json'),
);
collectIssues('creatures.json', creaturesParsed);

const battleParsed = battleSchema.safeParse(
  readJson(join(ROOT, 'data', 'battle.json'), 'battle.json'),
);
collectIssues('battle.json', battleParsed);

const encountersParsed = encountersSchema.safeParse(
  readJson(join(ROOT, 'data', 'world', 'encounters.json'), 'encounters.json'),
);
collectIssues('encounters.json', encountersParsed);

const speciesById = new Map<string, ParsedSpecies>();

for (const file of listFiles(SPECIES_DIR, '.json')) {
  const id = relative(SPECIES_DIR, file).replace(/\.json$/, '');
  const raw = readJson(file, `species/${id}.json`);
  if (raw === undefined) continue;
  const parsed = speciesSchema.safeParse(raw);
  collectIssues(`species/${id}.json`, parsed);
  if (!parsed.success) continue;

  // Gli id sono immutabili e legano i salvataggi (CLAUDE.md, regola 5): il
  // nome del file e l'id dentro devono combaciare, sempre.
  if (parsed.data.id !== id) {
    errors.push(`species/${id}.json: dichiara id "${parsed.data.id}"`);
  }
  speciesById.set(id, parsed.data);
}

if (
  movesParsed.success &&
  creaturesParsed.success &&
  battleParsed.success &&
  encountersParsed.success
) {
  errors.push(
    ...checkContent({
      species: speciesById,
      moves: movesParsed.data,
      battle: battleParsed.data,
      creatures: creaturesParsed.data,
      encounters: encountersParsed.data,
      translationKeys: referenceKeys,
      knownZones: new Set(maps.keys()),
    }),
  );
}

/* ----------------------------------------------------------------- rapporto */

// Le chiavi citate dai file di contenuto sono usate anche se nel codice non
// compare mai il loro letterale: il gioco le legge da `nameKey`.
for (const entry of speciesById.values()) usedKeys.add(entry.nameKey);
if (movesParsed.success) for (const move of movesParsed.data.moves) usedKeys.add(move.nameKey);
if (creaturesParsed.success) {
  for (const trait of creaturesParsed.data.traits) usedKeys.add(trait.nameKey);
}
if (battleParsed.success) for (const tool of battleParsed.data.tools) usedKeys.add(tool.nameKey);

// Le chiavi passate a t() tramite variabile (nomi di zona, testi dei cartelli)
// non compaiono nella scansione letterale: qui si contano come usate.
for (const map of maps.values()) {
  for (const property of map.properties) usedKeys.add(String(property.value));
  for (const layer of map.layers) {
    if (layer.type !== 'objectgroup') continue;
    for (const object of layer.objects) {
      for (const property of object.properties ?? []) usedKeys.add(String(property.value));
    }
  }
}

for (const key of referenceKeys) {
  if (!usedKeys.has(key)) warnings.push(`chiave "${key}" definita ma mai usata`);
}

for (const message of warnings) console.warn(`  avviso  ${message}`);

if (errors.length > 0) {
  console.error(`\nvalidate:data — ${errors.length} errore/i\n`);
  for (const message of errors) console.error(`  errore  ${message}`);
  console.error('');
  process.exit(1);
}

const translations = [...bundles.values()].reduce(
  (sum, bundle) => sum + Object.keys(bundle).length,
  0,
);
console.log(
  `validate:data — ok: ${bundles.size} lingue, ${translations} traduzioni, ${maps.size} mappe, ` +
    `${speciesById.size} specie, ${movesParsed.success ? movesParsed.data.moves.length : 0} mosse, ` +
    `${warnings.length} avviso/i`,
);
