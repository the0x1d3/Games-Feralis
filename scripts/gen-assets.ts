/**
 * Genera gli asset placeholder di Feralis: il tileset dei tre biomi e lo sprite
 * del giocatore.
 *
 * Perche' generati e non disegnati: il PDR §12 elenca "asset art sottovalutati"
 * fra i rischi ad alta probabilita' e prescrive di prototipare con placeholder
 * colorati. Generarli da codice li rende riproducibili bit per bit (nessun diff
 * sporco a ogni rigenerazione) e rende evidente che sono provvisori.
 *
 * Palette limitata come chiede il PDR §10: pochi colori, coerenti fra loro.
 *
 * Uso: npm run assets:gen
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noise, Raster, shade, type Rgba } from './lib/png';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TILE = 32;

const C = {
  waterDeep: [27, 75, 107, 255],
  waterShallow: [47, 127, 168, 255],
  sand: [217, 192, 138, 255],
  grass: [79, 143, 74, 255],
  grassDark: [53, 102, 58, 255],
  dirt: [138, 107, 69, 255],
  rock: [125, 127, 134, 255],
  cliff: [96, 98, 106, 255],
  trunk: [107, 74, 47, 255],
  canopy: [47, 107, 58, 255],
  bush: [63, 122, 60, 255],
  wood: [154, 114, 71, 255],
  snow: [230, 238, 242, 255],
  none: [0, 0, 0, 0],
} as const satisfies Record<string, Rgba>;

const SHADOW: Rgba = [0, 0, 0, 60];

/** Fondo screziato: base + granelli deterministici. */
function speckled(r: Raster, ox: number, oy: number, base: Rgba, salt: number, strength = 0.06) {
  r.fillRect(ox, oy, TILE, TILE, base);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const n = noise(x, y, salt);
      if (n > 0.86) r.set(ox + x, oy + y, shade(base, strength));
      else if (n < 0.14) r.set(ox + x, oy + y, shade(base, -strength));
    }
  }
}

/**
 * L'ordine di questo array E' l'indice del tile nel tileset, e finisce dentro i
 * file mappa. Cambiarlo significa rompere tutte le mappe: si aggiunge in fondo,
 * non si riordina. Stessa regola degli id in /data (CLAUDE.md, regola 5).
 */
const TILE_PAINTERS: ReadonlyArray<(r: Raster, ox: number, oy: number) => void> = [
  // 0 water_deep — onde orizzontali
  (r, ox, oy) => {
    speckled(r, ox, oy, C.waterDeep, 11, 0.05);
    for (let y = 4; y < TILE; y += 9) {
      for (let x = 2; x < TILE - 4; x += 1) {
        if (noise(x, y, 12) > 0.45)
          r.set(ox + x, oy + y + (x % 3 === 0 ? 1 : 0), shade(C.waterDeep, 0.09));
      }
    }
  },
  // 1 water_shallow
  (r, ox, oy) => {
    speckled(r, ox, oy, C.waterShallow, 21, 0.05);
    for (let y = 6; y < TILE; y += 11) {
      for (let x = 3; x < TILE - 5; x += 1) r.set(ox + x, oy + y, shade(C.waterShallow, 0.1));
    }
  },
  // 2 sand
  (r, ox, oy) => speckled(r, ox, oy, C.sand, 31, 0.05),
  // 3 grass — ciuffi
  (r, ox, oy) => {
    speckled(r, ox, oy, C.grass, 41);
    for (let i = 0; i < 7; i += 1) {
      const x = Math.floor(noise(i, 1, 42) * (TILE - 4)) + 2;
      const y = Math.floor(noise(i, 2, 43) * (TILE - 6)) + 3;
      r.fillRect(ox + x, oy + y, 1, 3, shade(C.grass, 0.08));
    }
  },
  // 4 grass_dark
  (r, ox, oy) => {
    speckled(r, ox, oy, C.grassDark, 51);
    for (let i = 0; i < 5; i += 1) {
      const x = Math.floor(noise(i, 1, 52) * (TILE - 4)) + 2;
      const y = Math.floor(noise(i, 2, 53) * (TILE - 6)) + 3;
      r.fillRect(ox + x, oy + y, 1, 4, shade(C.grassDark, 0.07));
    }
  },
  // 5 dirt_path
  (r, ox, oy) => {
    speckled(r, ox, oy, C.dirt, 61, 0.05);
    for (let i = 0; i < 6; i += 1) {
      const x = Math.floor(noise(i, 1, 62) * (TILE - 3)) + 1;
      const y = Math.floor(noise(i, 2, 63) * (TILE - 3)) + 1;
      r.fillRect(ox + x, oy + y, 2, 1, shade(C.dirt, -0.07));
    }
  },
  // 6 rock — masso (l'ostacolo della mansione Estrazione)
  (r, ox, oy) => {
    speckled(r, ox, oy, C.grass, 41);
    r.fillEllipse(ox + 16, oy + 18, 12, 10, C.rock);
    r.fillEllipse(ox + 13, oy + 14, 6, 4, shade(C.rock, 0.09));
    r.fillEllipse(ox + 20, oy + 23, 5, 3, shade(C.rock, -0.08));
  },
  // 7 cliff
  (r, ox, oy) => {
    speckled(r, ox, oy, C.cliff, 71, 0.05);
    r.fillRect(ox, oy, TILE, 4, shade(C.cliff, 0.12));
    for (let i = 0; i < 5; i += 1) {
      const x = Math.floor(noise(i, 1, 72) * (TILE - 6)) + 3;
      r.fillRect(ox + x, oy + 6, 1, TILE - 8, shade(C.cliff, -0.09));
    }
  },
  // 8 tree_trunk — la base solida dell'albero
  (r, ox, oy) => {
    speckled(r, ox, oy, C.grass, 41);
    r.fillEllipse(ox + 16, oy + 27, 9, 4, shade(C.grass, -0.09));
    r.fillRect(ox + 13, oy + 8, 6, 20, C.trunk);
    r.fillRect(ox + 13, oy + 8, 2, 20, shade(C.trunk, 0.07));
    r.fillRect(ox + 18, oy + 8, 1, 20, shade(C.trunk, -0.07));
  },
  // 9 tree_canopy — va nel layer sopra il giocatore: e' la prova visiva della profondita'
  (r, ox, oy) => {
    r.fillRect(ox, oy, TILE, TILE, C.none);
    r.fillEllipse(ox + 16, oy + 20, 15, 13, C.canopy);
    r.fillEllipse(ox + 11, oy + 14, 8, 7, shade(C.canopy, 0.08));
    r.fillEllipse(ox + 22, oy + 24, 7, 5, shade(C.canopy, -0.07));
  },
  // 10 bush — l'ostacolo della mansione Raccolta
  (r, ox, oy) => {
    speckled(r, ox, oy, C.grass, 41);
    r.fillEllipse(ox + 16, oy + 20, 11, 9, C.bush);
    r.fillEllipse(ox + 12, oy + 16, 5, 4, shade(C.bush, 0.09));
  },
  // 11 wood_floor
  (r, ox, oy) => {
    speckled(r, ox, oy, C.wood, 111, 0.04);
    for (let y = 0; y < TILE; y += 8) r.fillRect(ox, oy + y, TILE, 1, shade(C.wood, -0.1));
    r.fillRect(ox + 15, oy, 1, TILE, shade(C.wood, -0.08));
  },
  // 12 snow
  (r, ox, oy) => {
    speckled(r, ox, oy, C.snow, 121, 0.04);
    for (let i = 0; i < 4; i += 1) {
      const x = Math.floor(noise(i, 1, 122) * (TILE - 5)) + 2;
      const y = Math.floor(noise(i, 2, 123) * (TILE - 5)) + 2;
      r.fillEllipse(ox + x, oy + y, 2, 1, shade(C.snow, -0.06));
    }
  },
  // 13 sign — fondo TRASPARENTE: vive nel layer decor, sopra un terreno qualsiasi
  (r, ox, oy) => {
    r.fillRect(ox, oy, TILE, TILE, C.none);
    r.fillEllipse(ox + 16, oy + 27, 6, 2, SHADOW);
    r.fillRect(ox + 15, oy + 14, 2, 13, shade(C.wood, -0.12));
    r.fillRect(ox + 7, oy + 8, 18, 10, C.wood);
    r.fillRect(ox + 7, oy + 8, 18, 2, shade(C.wood, 0.09));
    for (let i = 0; i < 3; i += 1)
      r.fillRect(ox + 10, oy + 11 + i * 3, 12, 1, shade(C.wood, -0.16));
  },
];

const COLUMNS = 8;

function buildTileset(): Raster {
  const rows = Math.ceil(TILE_PAINTERS.length / COLUMNS);
  const raster = new Raster(COLUMNS * TILE, rows * TILE);
  TILE_PAINTERS.forEach((paint, index) => {
    paint(raster, (index % COLUMNS) * TILE, Math.floor(index / COLUMNS) * TILE);
  });
  return raster;
}

/* -------------------------------------------------------------------------- */

const BODY: Rgba = [86, 158, 176, 255];
const BODY_DARK: Rgba = [58, 120, 138, 255];
const CLOTH: Rgba = [206, 178, 120, 255];
const EYE: Rgba = [22, 32, 38, 255];

/** Un fotogramma per direzione: down, left, right, up (l'ordine e' quello di Facing). */
function paintPlayer(r: Raster, ox: number, facing: 'down' | 'left' | 'right' | 'up'): void {
  r.fillEllipse(ox + 16, 28, 9, 3, SHADOW);
  r.fillEllipse(ox + 16, 21, 8, 7, CLOTH); // mantello
  r.fillEllipse(ox + 16, 12, 8, 8, BODY); // testa
  r.fillEllipse(ox + 16, 8, 7, 4, BODY_DARK); // ciuffo

  // 'up' non ha occhi: si vede la nuca, ed e' cosi' che si legge la direzione.
  const eyes: Record<typeof facing, readonly number[]> = {
    down: [12, 18],
    left: [10, 14],
    right: [16, 20],
    up: [],
  };
  for (const x of eyes[facing]) r.fillRect(ox + x, 12, 2, 2, EYE);
}

function buildPlayer(): Raster {
  const raster = new Raster(TILE * 4, TILE);
  (['down', 'left', 'right', 'up'] as const).forEach((facing, index) => {
    paintPlayer(raster, index * TILE, facing);
  });
  return raster;
}

/* -------------------------------------------------------------------------- */

function write(relativePath: string, raster: Raster): void {
  const full = join(ROOT, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  const png = raster.toPng();
  writeFileSync(full, png);
  console.log(`  ${relativePath.padEnd(38)} ${raster.width}x${raster.height}  ${png.length} byte`);
}

console.log('gen-assets');
write('public/assets/tilesets/terrain.png', buildTileset());
write('public/assets/sprites/player.png', buildPlayer());
console.log('gen-assets — ok (ricorda di aggiornare ASSETS.md se aggiungi un file)');
