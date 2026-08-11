/**
 * Budget di dimensione, imposto dalla CI.
 *
 * Il PDR §3.3 fissa 12 MB totali e 3 MB per il primo caricamento giocabile. Non
 * e' pignoleria: GitHub Pages concede 100 GB di banda al mese, e un progetto
 * senza budget scopre il problema quando il gioco smette di caricare.
 *
 * Misuriamo anche la dimensione compressa, perche' e' quella che viaggia
 * davvero: Pages serve gzip/brotli, e un bundle JS si comprime di circa 3-4
 * volte. Il budget duro resta sul non compresso, che e' il dato che finisce
 * nella cache del browser e nel repository.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');

const MB = 1024 * 1024;

/** PDR §3.3: build totale. Superarlo fa fallire la CI. */
const TOTAL_BUDGET = 12 * MB;

/**
 * PDR §3.3: primo caricamento giocabile. Finche' non esiste il lazy-loading per
 * scena (Fase 7) questo e' un AVVISO e non un errore: bloccare la CI su un
 * budget che l'architettura non puo' ancora rispettare insegna solo a ignorare
 * la CI.
 */
const FIRST_LOAD_BUDGET = 3 * MB;

interface Entry {
  readonly path: string;
  readonly bytes: number;
  readonly gzipped: number;
}

function collect(dir: string): Entry[] {
  const entries: Entry[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...collect(full));
      continue;
    }
    const content = readFileSync(full);
    entries.push({
      path: relative(DIST, full).replace(/\\/g, '/'),
      bytes: content.byteLength,
      gzipped: gzipSync(content).byteLength,
    });
  }
  return entries;
}

function format(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

try {
  statSync(DIST);
} catch {
  console.error('size-check — dist/ non esiste: esegui prima `npm run build`');
  process.exit(1);
}

const entries = collect(DIST).sort((a, b) => b.bytes - a.bytes);
const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
const totalGzipped = entries.reduce((sum, entry) => sum + entry.gzipped, 0);

/* Approssimazione del primo caricamento: la pagina piu' tutto cio' che l'entry
 * porta con se'. Finche' non ci sono chunk lazy, coincide con il totale del JS
 * e del CSS. */
const firstLoad = entries
  .filter((entry) => /\.(html|css|js)$/.test(entry.path))
  .reduce((sum, entry) => sum + entry.bytes, 0);

console.log('size-check');
console.log(`  file            ${entries.length}`);
console.log(`  totale          ${format(total)}  (compresso ${format(totalGzipped)})`);
console.log(`  budget totale   ${format(TOTAL_BUDGET)}`);
console.log(`  primo carico    ${format(firstLoad)}  su ${format(FIRST_LOAD_BUDGET)}`);
console.log('  piu pesanti:');
for (const entry of entries.slice(0, 5)) {
  console.log(
    `    ${format(entry.bytes).padStart(10)}  ${entry.path}  (gz ${format(entry.gzipped)})`,
  );
}

if (firstLoad > FIRST_LOAD_BUDGET) {
  console.warn(
    `\n  avviso  primo caricamento a ${format(firstLoad)}, sopra i ${format(FIRST_LOAD_BUDGET)} del PDR.` +
      '\n          Rientra con il code splitting per scena previsto in Fase 7.',
  );
}

if (total > TOTAL_BUDGET) {
  console.error(
    `\nsize-check — FALLITO: ${format(total)} superano il budget di ${format(TOTAL_BUDGET)}.\n`,
  );
  process.exit(1);
}

console.log('\nsize-check — ok');
