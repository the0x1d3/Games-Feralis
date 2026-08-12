/**
 * Simulatore di bilanciamento della Radura.
 *
 * Vale per la Fase 4 quel che `balance-sim.ts` vale per la Fase 2: i numeri di
 * `data/base.json` e `data/structures.json` non si scelgono a occhio (PDR §12,
 * e l'anti-pattern esplicito in CLAUDE.md).
 *
 * Le tre domande a cui deve rispondere:
 *  1. una Radura di partenza con tre Ferali si mantiene da sola per otto ore?
 *  2. otto ore offline valgono abbastanza da farci tornare, senza svuotare il
 *     gioco di ogni motivo per giocarlo?
 *  3. il recupero costa poche decine di segmenti e non trecentomila tick?
 *
 * File separato da `balance-sim.ts` perché quello aveva già raggiunto le sue
 * righe utili e perché sono due domini distinti (CLAUDE.md, regola 8).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBaseConfig, parseStructures } from '../src/domain/base/config';
import { simulateOffline, type OfflineContext } from '../src/domain/base/offline';
import type { Worker } from '../src/domain/base/production';
import { emptyBase, type BaseState, type PlacedStructure } from '../src/domain/base/state';
import { parseWorldConfig } from '../src/domain/world/config';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = (...parts: string[]): unknown =>
  JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8'));

const config = parseBaseConfig(readJson('data', 'base.json'));
const structures = parseStructures(readJson('data', 'structures.json'));
const world = parseWorldConfig(readJson('data', 'world', 'world.json'));

/** La Radura del minuto 10: un Totem, un orto, un taglialegna, una cava. */
const STARTER: ReadonlyArray<{ id: string; structureId: string; worker?: string }> = [
  { id: 'orto', structureId: 'orto', worker: 'w1' },
  { id: 'legna', structureId: 'taglialegna', worker: 'w2' },
  { id: 'cava', structureId: 'cava', worker: 'w3' },
];

const workers = new Map<string, Worker>([
  ['w1', { uid: 'w1', workLevel: 1, nocturnal: false }],
  ['w2', { uid: 'w2', workLevel: 1, nocturnal: false }],
  ['w3', { uid: 'w3', workLevel: 1, nocturnal: false }],
]);

function placed(entry: (typeof STARTER)[number], index: number): PlacedStructure {
  return {
    id: entry.id,
    structureId: entry.structureId,
    tx: 12 + index * 3,
    ty: 12,
    workUnits: 0,
    ...(entry.worker === undefined ? {} : { workerUid: entry.worker }),
  };
}

function starterBase(cibo: number): BaseState {
  return {
    ...emptyBase(),
    totem: { zoneId: 'costa', tx: 10, ty: 10 },
    structures: STARTER.map(placed),
    resources: { cibo },
    morale: config.food.startingMorale,
  };
}

const context: OfflineContext = { config, structures, workers, time: world.time };

const EIGHT_HOURS = config.offline.capMs;
const START = world.time.startHour * (world.time.dayLengthRealMs / 24);

/* ------------------------------------------------------------ simulazioni */

console.log('balance:base');
console.log(`  Radura di partenza: ${STARTER.length} strutture, ${workers.size} Ferali`);

const withFood = simulateOffline(
  { base: starterBase(20), gameTimeMs: START, elapsedMs: EIGHT_HOURS },
  context,
);
/**
 * Una Radura senza orto e senza scorte: serve a misurare la fame.
 *
 * La prima versione di questa prova usava la Radura di partenza con zero cibo e
 * non misurava nulla, perché l'orto sfamava i suoi stessi lavoratori dopo il
 * primo ciclo. La fame si vede solo dove il cibo non nasce da solo.
 */
function hungryBase(): BaseState {
  return {
    ...starterBase(0),
    structures: [
      { id: 'legna', structureId: 'taglialegna', tx: 12, ty: 12, workUnits: 0, workerUid: 'w1' },
      { id: 'cava', structureId: 'cava', tx: 15, ty: 12, workUnits: 0, workerUid: 'w2' },
    ],
  };
}

const withoutFood = simulateOffline(
  { base: hungryBase(), gameTimeMs: START, elapsedMs: EIGHT_HOURS },
  context,
);

const foodMade = withFood.produced['cibo'] ?? 0;
const foodEaten = withFood.consumed['cibo'] ?? 0;

console.log('\n  otto ore con la mangiatoia piena');
console.log(`    cibo prodotto  ${foodMade}`);
console.log(`    cibo consumato ${foodEaten}`);
console.log(`    legna          ${withFood.produced['legna'] ?? 0}`);
console.log(`    pietra         ${withFood.produced['pietra'] ?? 0}`);
console.log(`    morale finale  ${withFood.base.morale}`);
console.log(`    segmenti       ${withFood.segments}`);

console.log('\n  otto ore a digiuno');
console.log(`    morale finale  ${withoutFood.base.morale}`);
console.log(`    legna          ${withoutFood.produced['legna'] ?? 0}`);

/* --------------------------------------------------------------- verdetto */

const problems: string[] = [];

// 1. Autosufficienza: un orto deve sfamare i tre che lo tengono in piedi,
//    altrimenti la Radura si spegne da sola e il giocatore non capisce perché.
if (foodMade <= foodEaten) {
  problems.push(
    `la Radura non si mantiene: produce ${foodMade} cibo e ne consuma ${foodEaten} in otto ore`,
  );
}

// 2. Il rientro deve valere la pena, ma non deve sostituire il gioco. Sotto le
//    50 unità di legna non si costruisce nulla; sopra le 400 non c'è motivo di
//    giocare la parte esplorativa.
const wood = withFood.produced['legna'] ?? 0;
if (wood < 50 || wood > 400) {
  problems.push(`otto ore rendono ${wood} legna, fuori dal target 50–400`);
}

// 3. Il morale non deve crollare con la dispensa piena.
if (withFood.base.morale < config.production.moraleThresholds.full) {
  problems.push(`con il cibo il morale scende a ${withFood.base.morale}, sotto la soglia "pieno"`);
}

// 4. A digiuno deve invece scendere davvero: la mangiatoia serve a qualcosa.
if (withoutFood.base.morale >= config.production.moraleThresholds.low) {
  problems.push(`a digiuno il morale resta a ${withoutFood.base.morale}: la fame non morde`);
}

// 5. Il costo del recupero è la ragione per cui esiste l'ADR 0002.
if (withFood.segments > 100) {
  problems.push(`otto ore costano ${withFood.segments} segmenti: troppi per l'ADR 0002`);
}

if (problems.length > 0) {
  console.error('\nbalance:base — FALLITO\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('\nbalance:base — ok');
