/**
 * Chiavi e percorsi degli asset.
 *
 * I percorsi passano SEMPRE da `import.meta.env.BASE_URL` (CLAUDE.md, regola 7):
 * il gioco vive sotto `/Games-Feralis/` su Pages ma deve poter cambiare origine
 * senza che nessuno vada a caccia di stringhe.
 */

export const TEXTURE = {
  terrain: 'terrain',
  player: 'player',
  creatures: 'creatures',
} as const;

export const CREATURE_FRAME_SIZE = 48;

/** Deve combaciare con `tilesetName` in data/world/tiles.json. */
export const TILESET_NAME = 'terrain';

export const LAYER = {
  ground: 'ground',
  decor: 'decor',
  over: 'over',
} as const;

/** L'ordine di disegno. Il giocatore sta in mezzo: e' li' che si legge la profondita'. */
export const DEPTH = {
  ground: 0,
  decor: 1,
  player: 10,
  over: 20,
  ambient: 30,
} as const;

export function assetUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}assets/${relativePath}`;
}
