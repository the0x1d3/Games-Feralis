/**
 * Autore delle mappe: da ASCII disegnato a mano a JSON in formato Tiled.
 *
 * Il PDR §6.1 vuole Tiled come strumento di mappatura, e l'output di questo
 * script E' un file Tiled valido: si apre, si modifica e si riesporta con Tiled
 * senza conversioni. Ma finche' le mappe sono placeholder, l'ASCII qui sotto e'
 * incomparabilmente piu' leggibile in una pull request di 1200 numeri per layer,
 * e un errore di battitura si vede a occhio.
 *
 * Ogni riga e' spezzata in quattro segmenti da 10 caratteri: contare fino a 40
 * a mano e' il modo piu' rapido di introdurre un bug invisibile, quindi lo
 * script verifica le lunghezze e fallisce forte.
 *
 * Dalla Fase 6 (contenuti veri) la fonte diventa Tiled e questo script si
 * cancella. Vedi docs/ADR/0005.
 *
 * Uso: npm run maps:build
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = join(ROOT, 'data', 'maps');

const TILE = 32;
const WIDTH = 40;
const HEIGHT = 30;
const SEGMENT = 10;

/* ------------------------------------------------------------------ legenda */

interface LegendEntry {
  /** Tile di fondo, sempre presente. */
  readonly ground: number;
  /** Tile nel layer intermedio, sotto il giocatore. Deve avere fondo trasparente. */
  readonly decor?: number;
  /** Tile piazzato nel layer SOPRA il giocatore, una casella piu' in alto. */
  readonly overAbove?: number;
}

const LEGEND: Readonly<Record<string, LegendEntry>> = {
  '~': { ground: 0 }, // mare profondo
  '-': { ground: 1 }, // acqua bassa — si attraversera' con la mansione Acqua
  '.': { ground: 2 }, // sabbia
  ',': { ground: 3 }, // erba
  ':': { ground: 4 }, // erba scura
  '=': { ground: 5 }, // sentiero
  o: { ground: 6 }, // masso — mansione Estrazione
  '^': { ground: 7 }, // rupe
  T: { ground: 8, overAbove: 9 }, // albero: tronco solido + chioma sopra il giocatore
  '*': { ground: 10 }, // arbusto — mansione Raccolta
  w: { ground: 11 }, // assito
  s: { ground: 12 }, // neve
  '%': { ground: 13 }, // erba alta — è qui che compaiono i Ferali selvatici
  i: { ground: 3, decor: 14 }, // cartello su erba
  I: { ground: 2, decor: 14 }, // cartello su sabbia
  /*
   * Ostacoli della Fase 5. Il tile da' l'aspetto e la solidita' iniziale, ma
   * chi decide se sono ancora in piedi e' l'oggetto "obstacle" nella lista
   * della zona: rimosso l'ostacolo, la casella torna quella dichiarata in
   * `clearedTile`. Vive tutto nel dato, niente coordinate scritte nel codice.
   */
  '#': { ground: 15 }, // barriera di ghiaccio — mansione Fiamma
  F: { ground: 16 }, // braci ardenti — mansione Acqua
  B: { ground: 17 }, // assito sfondato — mansione Artigianato
  D: { ground: 18 }, // terreno duro — mansione Coltivazione
};

/* -------------------------------------------------------------------- mappe */

type Rows = ReadonlyArray<readonly [string, string, string, string]>;

interface ZoneSource {
  readonly id: string;
  readonly nameKey: string;
  readonly rows: Rows;
  readonly objects: ReadonlyArray<ObjectSource>;
}

type ObjectSource =
  | { readonly kind: 'spawn'; readonly name: string; readonly tx: number; readonly ty: number }
  | {
      readonly kind: 'exit';
      readonly tx: number;
      readonly ty: number;
      readonly tw: number;
      readonly th: number;
      readonly toZone: string;
      readonly toSpawn: string;
    }
  | { readonly kind: 'sign'; readonly tx: number; readonly ty: number; readonly textKey: string }
  | {
      readonly kind: 'obstacle';
      readonly name: string;
      readonly nameKey: string;
      readonly tx: number;
      readonly ty: number;
      readonly tw: number;
      readonly th: number;
      readonly work: string;
      readonly level: number;
      /** Il tile che resta quando l'ostacolo viene rimosso. */
      readonly clearedTile: number;
      readonly requiresItem?: string;
    };

const COSTA: Rows = [
  ['~~~,,,,,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,,,'],
  ['~~~,,,,,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,,,'],
  ['~~~,,,,T,,', ',,,T,,,,==', '=,,,,,T,,,', ',,,T,,,,,,'],
  ['~~~,%%%,,,', ',,,,,,,,==', '=,,%%%,,,,', ',,,,,,,,,,'],
  ['~~~%%%*,,,', ',,,,,,,,==', '=,,%%%,,*,', ',,,,,,,T,,'],
  ['~~~,%%,,,,', ',,%%%,,,==', '=,,%%,,,,,', ',,,%%%,,,,'],
  ['~~~,,,,,,,', ',,T%%,,,==', '=,,,,%%,,,', ',,,%%%,,,,'],
  ['~~~,%%%,,,', ',,,%%,,,==', '=,,,,,,,,,', ',,%%,,,T,,'],
  ['~~~,,%%,,,', ',,,,,,,,==', '=,,%%%,,,,', ',,,,,,,,,,'],
  ['~~~,,,,,,,', ',,%%%,,,==', '=,,,,,,,,,', ',,,%%,,,,,'],
  ['~~~,,,,,o,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,o,,,,,'],
  ['~~~,,,,,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,,,'],
  ['~~~.,,,,,,', ',,,,,,,,==', '=,,,,DD,,,', ',,,,,,,,,,'],
  ['~~~..,,,,,', ',,,,,,,,==', '=,,,,,,,,.', '.,,,,,,,,,'],
  ['~~~...,,,,', ',,,,,,,,==', '=,,,,,,...', '..,,,,,,,,'],
  ['~~~....,,,', ',,,,,,,,==', '=,,,,.....', '...,,,,,,,'],
  ['~~~.....,,', '.,,,,,,,==', '=,,......w', 'ww.,,,,,,,'],
  ['~~~......,', '..,,,,,,==', '=,,......w', 'BB..,,,,,,'],
  ['~~~.......', '...,,,,,==', '=.......Iw', 'ww...,,,,,'],
  ['~~~.......', '.....,,,==', '=.........', '.....,,,,,'],
  ['~~~.......', '.......I..', '..........', '......,,,,'],
  ['~~-.......', '..........', '..........', '.........,'],
  ['~~-.......', '..........', '..........', '..........'],
  ['~~--......', '..........', '..........', '..........'],
  ['~~---.....', '..........', '.........-', '-.........'],
  ['~~----....', '.......---', '----------', '----......'],
  ['~~~~~~----', '----------', '----------', '------....'],
  ['~~~~~~~~~~', '~~~~~~----', '----------', '--------..'],
  ['~~~~~~~~~~', '~~~~~~~~~~', '~~~~~~~~~~', '~~~~~~----'],
  ['~~~~~~~~~~', '~~~~~~~~~~', '~~~~~~~~~~', '~~~~~~~~~~'],
];

const BOSCO: Rows = [
  ['TTTTTTTTTT', 'TTTTTTTTTT', 'TTTTTTTTTT', 'TTTTTTTTTT'],
  ['T::::::::T', '::::::::::', '::::::::::', 'T::::::::T'],
  ['T:,,,,,,:T', ':,,,,T,,,:', ':,,,,,,,,:', 'T:,,,,,,:T'],
  ['T:,%%%,,,,', ',,,,%%%,,,', ',,%%%,,,,,', ',,,,%%,,:T'],
  ['T:,,,T,,,,', ',,,,,,,,,,', ',,,,,T,,,,', ',,,,,,,,:T'],
  ['T:,,,,,,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,:T'],
  ['T:%%%,,,*,', ',,,%%,,,==', '=,%%%,,,,,', ',,,,,*,,:T'],
  ['T:,,%%%,,,', ',,,,,,,,==', '=,,,%%%,,,', ',,%%,,,,:T'],
  ['T:,,T,,,,,', ',,,,,,,,==', '=,,,,,,T,,', ',,,,,,,,:T'],
  ['T:,,,,,,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,:T'],
  ['T:,%%%,,,,', ',,%%,,,,==', '=,,,,%%%,,', ',,,,,,,,:T'],
  ['T:,,,%%,,,', ',,,,,,,,==', '=,,%%,,,,,', ',,%%%,,,:T'],
  ['T:,,,,,,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,:T'],
  ['T:,,,,,,,,', ',,,,,,,,==', '==========', '========o='],
  ['T:,,,,,,,,', ',,,,,,,,==', '==========', '========o='],
  ['T:,,,,,,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,:T'],
  ['T:,,,,o,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,:T'],
  ['T:,%%%,,,,', ',,,,%%,,==', '=,,,,,%%,,', ',,,,,,,,:T'],
  ['T:,,,,%%,,', ',,%%%,,,==', '=,,%%,,,,,', ',,,,%%,,:T'],
  ['T:,,,T,,,,', ',,,,,,,,==', '=,,,,T,,,,', ',,,,,,,,:T'],
  ['T:,,,,,,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,:T'],
  ['T:,%%,,,,,', ',,,,%%%,==', '=,,,,,,,,,', ',,%%%,,,:T'],
  ['T:,,,*,,,,', ',,,,,,,,==', '=,,,,,,,*,', ',,,,,,,,:T'],
  ['T:,,,,,,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,,,,,,:T'],
  ['T:,,%%%,,,', ',,,,,,,,==', '=,%%%,,,,,', ',,,,,%%,:T'],
  ['T:,,,,T,,,', ',,,,,,,,==', '=,,,,,,,,,', ',,,T,,,,:T'],
  ['T:,,,,,,,,', ',,,,,,,i==', '=,,,,,,,,,', ',,,,,,,,:T'],
  ['T:,,,,,,,:', 'T,,,,,,,==', '=,,,,,,,T:', ',,,,,,,,:T'],
  ['T::::::::T', '::::::,,==', '=,::::::::', 'T::::::::T'],
  ['TTTTTTTTTT', 'TTTTTTTT==', '=TTTTTTTTT', 'TTTTTTTTTT'],
];

const ALTOPIANO: Rows = [
  ['^^^^^^^^^^', '^^^^^^^^^^', '^^^^^^^^^^', '^^^^^^^^^^'],
  ['^ssssssss^', 'ssssssssss', 'ssssssssss', '^ssssssss^'],
  ['^sssossss^', 'ssssssssss', 'sssssossss', '^ssssssss^'],
  ['^#########', '##########', '##########', '#########^'],
  ['^ss::::ss^', 'ss::::::ss', 'ss::::::ss', '^ss::::ss^'],
  ['^:::::::::', '::::::::::', '::::::::::', ':::::::::^'],
  ['^:::,,,,,,', ',,,,,,,,,,', ',,,,,,,,,,', ',,,,,::::^'],
  ['^::,,,,,,,', ',,,,o,,,,,', ',,,,,,,,,,', ',,,,,,:::^'],
  ['^:,%%%,,,,', ',,,%%%,,,,', ',,,,,%%%,,', ',,,,,,,::^'],
  ['^:,,,,,,,,', ',,,,,,,,,,', ',,,,,,,,,,', ',,,,,,,,:^'],
  ['^,,%%,,,,,', ',,%%%,,,,,', ',,,,,,%%,,', ',,,%%,,,,^'],
  ['^,,,,,,,,,', ',,,,,,,,,,', ',,,,,o,,,,', ',,,,,,,,,^'],
  ['^,,,,,,,,,', ',,,,,,,,,,', ',,,,,FF,,,', ',,,,,,,,,^'],
  ['==========', '==========', '=====,,,,,', ',,,,,,,,,^'],
  ['==========', '==========', '=====,,,,,', ',,,,,,,,,^'],
  ['^,,,,,i,,,', ',,,,,,,,,,', ',,,,,,,,,,', ',,,,,,,,,^'],
  ['^,,,%%%,,,', ',,,,,%%,,,', ',,%%%,,,,,', ',,,,,%%,,^'],
  ['^,,,,o,,,,', ',,,,,,,,,,', ',,,,,,,,,,', ',,,,,,,,,^'],
  ['^,%%,,,,,,', ',,,,%%%,,,', ',,,,,,%%%,', ',,%%,,,,,^'],
  ['^:,,,,,,,,', ',,,,,,,,,,', ',,,,,,,,,,', ',,,,,,,,:^'],
  ['^::,,,,,,,', ',,,,,,,,,,', ',,,,,,,,,,', ',,,,,,,::^'],
  ['^:::,,,,,,', ',,,,,,,,,,', ',,,,,,,,,,', ',,,,,,:::^'],
  ['^::::,,,,,', ',,,,,,,,,,', ',,,,,,,,,,', ',,,,,::::^'],
  ['^:::::::::', '::::::::::', '::::::::::', ':::::::::^'],
  ['^^::::::::', '::::::::::', '::::::::::', '::::::::^^'],
  ['^^^^^^::::', '::::::::::', '::::::::::', '::::^^^^^^'],
  ['^^^^^^^^^^', '^^::::::::', '::::::::^^', '^^^^^^^^^^'],
  ['^^^^^^^^^^', '^^^^^^::::', '::::^^^^^^', '^^^^^^^^^^'],
  ['^^^^^^^^^^', '^^^^^^^^^^', '^^^^^^^^^^', '^^^^^^^^^^'],
  ['^^^^^^^^^^', '^^^^^^^^^^', '^^^^^^^^^^', '^^^^^^^^^^'],
];

const ZONES: readonly ZoneSource[] = [
  {
    id: 'costa',
    nameKey: 'world.zone.costa',
    rows: COSTA,
    objects: [
      { kind: 'spawn', name: 'start', tx: 19, ty: 21 },
      { kind: 'spawn', name: 'from_bosco', tx: 19, ty: 2 },
      { kind: 'exit', tx: 18, ty: 0, tw: 3, th: 1, toZone: 'bosco', toSpawn: 'from_costa' },
      { kind: 'sign', tx: 17, ty: 20, textKey: 'world.sign.beach' },
      { kind: 'sign', tx: 28, ty: 18, textKey: 'world.sign.totem' },
      {
        kind: 'obstacle',
        name: 'arbusto_spiaggia',
        nameKey: 'obstacle.arbusto',
        tx: 6,
        ty: 4,
        tw: 1,
        th: 1,
        work: 'gathering',
        level: 1,
        clearedTile: 3,
      },
      {
        kind: 'obstacle',
        name: 'terreno_duro',
        nameKey: 'obstacle.terreno_duro',
        tx: 25,
        ty: 12,
        tw: 2,
        th: 1,
        work: 'farming',
        level: 1,
        clearedTile: 3,
      },
      {
        kind: 'obstacle',
        name: 'pontile_rotto',
        nameKey: 'obstacle.pontile',
        tx: 30,
        ty: 17,
        tw: 2,
        th: 1,
        work: 'crafting',
        level: 1,
        clearedTile: 11,
      },
    ],
  },
  {
    id: 'bosco',
    nameKey: 'world.zone.bosco',
    rows: BOSCO,
    objects: [
      { kind: 'spawn', name: 'from_costa', tx: 19, ty: 27 },
      { kind: 'spawn', name: 'from_altopiano', tx: 37, ty: 14 },
      { kind: 'exit', tx: 18, ty: 29, tw: 3, th: 1, toZone: 'costa', toSpawn: 'from_bosco' },
      { kind: 'exit', tx: 39, ty: 13, tw: 1, th: 2, toZone: 'altopiano', toSpawn: 'from_bosco' },
      { kind: 'sign', tx: 17, ty: 26, textKey: 'world.sign.forest' },
      /*
       * IL masso della Fase 5. Chiude l'unico accesso all'uscita verso
       * l'Altopiano: le caselle sopra e sotto sono alberi, quindi non si aggira.
       * Serve un Ferale con Estrazione 2.
       */
      {
        kind: 'obstacle',
        name: 'masso_altopiano',
        nameKey: 'obstacle.masso',
        tx: 38,
        ty: 13,
        tw: 1,
        th: 2,
        work: 'mining',
        level: 2,
        clearedTile: 5,
      },
    ],
  },
  {
    id: 'altopiano',
    nameKey: 'world.zone.altopiano',
    rows: ALTOPIANO,
    objects: [
      { kind: 'spawn', name: 'from_bosco', tx: 3, ty: 13 },
      { kind: 'exit', tx: 0, ty: 13, tw: 1, th: 2, toZone: 'bosco', toSpawn: 'from_altopiano' },
      { kind: 'sign', tx: 6, ty: 15, textKey: 'world.sign.highland' },
      {
        kind: 'obstacle',
        name: 'barriera_ghiaccio',
        nameKey: 'obstacle.ghiaccio',
        tx: 1,
        ty: 3,
        tw: 38,
        th: 1,
        work: 'flame',
        level: 2,
        clearedTile: 12,
        requiresItem: 'mantello_lana',
      },
      {
        kind: 'obstacle',
        name: 'braci',
        nameKey: 'obstacle.braci',
        tx: 25,
        ty: 12,
        tw: 2,
        th: 1,
        work: 'water',
        level: 1,
        clearedTile: 3,
        requiresItem: 'tunica_ignifuga',
      },
    ],
  },
];

/* ------------------------------------------------------------------ builder */

function flatten(rows: Rows, zoneId: string): string[] {
  if (rows.length !== HEIGHT) {
    throw new Error(`${zoneId}: ${rows.length} righe invece di ${HEIGHT}`);
  }
  return rows.map((segments, y) => {
    segments.forEach((segment, index) => {
      if (segment.length !== SEGMENT) {
        throw new Error(
          `${zoneId}: riga ${y}, segmento ${index} lungo ${segment.length} invece di ${SEGMENT}: "${segment}"`,
        );
      }
    });
    return segments.join('');
  });
}

interface Layers {
  readonly ground: number[];
  readonly decor: number[];
  readonly over: number[];
}

function buildLayers(grid: readonly string[], zoneId: string): Layers {
  const size = WIDTH * HEIGHT;
  const ground = new Array<number>(size).fill(0);
  const decor = new Array<number>(size).fill(0);
  const over = new Array<number>(size).fill(0);

  for (let y = 0; y < HEIGHT; y += 1) {
    const row = grid[y] ?? '';
    for (let x = 0; x < WIDTH; x += 1) {
      const char = row[x] ?? '';
      const entry = LEGEND[char];
      if (entry === undefined) {
        throw new Error(`${zoneId}: carattere sconosciuto "${char}" in (${x}, ${y})`);
      }
      // I gid di Tiled partono da 1: 0 significa "casella vuota".
      ground[y * WIDTH + x] = entry.ground + 1;
      if (entry.decor !== undefined) decor[y * WIDTH + x] = entry.decor + 1;
      if (entry.overAbove !== undefined && y > 0) {
        over[(y - 1) * WIDTH + x] = entry.overAbove + 1;
      }
    }
  }

  return { ground, decor, over };
}

function tileLayer(id: number, name: string, data: readonly number[]): object {
  return {
    id,
    name,
    type: 'tilelayer',
    data,
    width: WIDTH,
    height: HEIGHT,
    opacity: 1,
    visible: true,
    x: 0,
    y: 0,
  };
}

function buildObjects(sources: ReadonlyArray<ObjectSource>): object[] {
  return sources.map((source, index) => {
    const id = index + 1;
    if (source.kind === 'exit') {
      return {
        id,
        name: `${source.toZone}:${source.toSpawn}`,
        type: 'exit',
        x: source.tx * TILE,
        y: source.ty * TILE,
        width: source.tw * TILE,
        height: source.th * TILE,
        rotation: 0,
        visible: true,
        properties: [
          { name: 'toZone', type: 'string', value: source.toZone },
          { name: 'toSpawn', type: 'string', value: source.toSpawn },
        ],
      };
    }

    if (source.kind === 'obstacle') {
      return {
        id,
        name: source.name,
        type: 'obstacle',
        x: source.tx * TILE,
        y: source.ty * TILE,
        width: source.tw * TILE,
        height: source.th * TILE,
        rotation: 0,
        visible: true,
        properties: [
          { name: 'nameKey', type: 'string', value: source.nameKey },
          { name: 'work', type: 'string', value: source.work },
          { name: 'level', type: 'string', value: String(source.level) },
          { name: 'clearedTile', type: 'string', value: String(source.clearedTile) },
          ...(source.requiresItem === undefined
            ? []
            : [{ name: 'requiresItem', type: 'string', value: source.requiresItem }]),
        ],
      };
    }

    const common = {
      id,
      x: source.tx * TILE + TILE / 2,
      y: source.ty * TILE + TILE / 2,
      width: 0,
      height: 0,
      rotation: 0,
      point: true,
      visible: true,
    };

    if (source.kind === 'spawn') {
      return { ...common, name: source.name, type: 'spawn', properties: [] };
    }
    return {
      ...common,
      name: '',
      type: 'sign',
      properties: [{ name: 'textKey', type: 'string', value: source.textKey }],
    };
  });
}

function buildZone(zone: ZoneSource): object {
  const grid = flatten(zone.rows, zone.id);
  const layers = buildLayers(grid, zone.id);

  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.0',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    compressionlevel: -1,
    width: WIDTH,
    height: HEIGHT,
    tilewidth: TILE,
    tileheight: TILE,
    nextlayerid: 5,
    nextobjectid: zone.objects.length + 1,
    properties: [{ name: 'nameKey', type: 'string', value: zone.nameKey }],
    tilesets: [
      {
        firstgid: 1,
        name: 'terrain',
        image: '../../public/assets/tilesets/terrain.png',
        imagewidth: 256,
        imageheight: 96,
        tilewidth: TILE,
        tileheight: TILE,
        tilecount: 19,
        columns: 8,
        margin: 0,
        spacing: 0,
      },
    ],
    layers: [
      tileLayer(1, 'ground', layers.ground),
      tileLayer(2, 'decor', layers.decor),
      tileLayer(3, 'over', layers.over),
      {
        id: 4,
        name: 'objects',
        type: 'objectgroup',
        draworder: 'topdown',
        opacity: 1,
        visible: true,
        x: 0,
        y: 0,
        objects: buildObjects(zone.objects),
      },
    ],
  };
}

/* ---------------------------------------------------------------- esecuzione */

mkdirSync(OUT_DIR, { recursive: true });
console.log('author-maps');

for (const zone of ZONES) {
  const map = buildZone(zone);
  const file = join(OUT_DIR, `${zone.id}.json`);
  writeFileSync(file, `${JSON.stringify(map, null, 1)}\n`, 'utf8');
  console.log(`  ${zone.id.padEnd(12)} ${WIDTH}x${HEIGHT}  ${zone.objects.length} oggetti`);
}

console.log('author-maps — ok');
