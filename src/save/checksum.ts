/**
 * CRC32, usato per accorgersi che un codice di scambio e' stato troncato o
 * incollato male.
 *
 * Non e' una firma: chi vuole barare in un single-player puo' farlo comunque, e
 * il PDR §6.4 lo mette per iscritto. Serve a distinguere "l'amico ha copiato
 * solo meta' stringa da WhatsApp" da "il codice e' valido".
 */

const TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = (TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32Hex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(8, '0');
}
