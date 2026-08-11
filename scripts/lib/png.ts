/**
 * Encoder PNG minimo e piccolo raster in memoria.
 *
 * Serve a generare gli asset placeholder senza aggiungere una dipendenza di
 * disegno al progetto. Il PDR §12 chiede di prototipare con placeholder
 * colorati e di bloccare lo stile su poche creature prima di disegnarne 24:
 * questi file esistono per essere buttati via.
 */
import { deflateSync } from 'node:zlib';

export type Rgba = readonly [number, number, number, number];

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Superficie RGBA su cui disegnare con primitive elementari. */
export class Raster {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0];
    this.data[i + 1] = color[1];
    this.data[i + 2] = color[2];
    this.data[i + 3] = color[3];
  }

  fillRect(x: number, y: number, w: number, h: number, color: Rgba): void {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) this.set(x + dx, y + dy, color);
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: Rgba): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, color);
      }
    }
  }

  toPng(): Buffer {
    const stride = this.width * 4;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (stride + 1)] = 0; // filtro "None"
      Buffer.from(this.data.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colore RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', new Uint8Array(0)),
    ]);
  }
}

/**
 * Rumore deterministico da coordinate. Non e' il RNG di gioco (quello vive in
 * src/domain/rng.ts): serve solo a screziare i placeholder, e deve dare sempre
 * lo stesso file a parita' di input, altrimenti ogni rigenerazione sporca il diff.
 */
export function noise(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 0x9e37, 0x85eb) ^ Math.imul(y + 0x79b9, 0xc2b2) ^ Math.imul(salt, 0x27d4);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Schiarisce o scurisce un colore di una frazione. */
export function shade(color: Rgba, amount: number): Rgba {
  const mix = (channel: number): number =>
    Math.max(0, Math.min(255, Math.round(channel + 255 * amount)));
  return [mix(color[0]), mix(color[1]), mix(color[2]), color[3]];
}
