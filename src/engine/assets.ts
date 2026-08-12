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
  structures: 'structures',
} as const;

export const CREATURE_FRAME_SIZE = 48;

/**
 * Ogni struttura sta in un fotogramma da 3x2 tile, ancorata in alto a sinistra;
 * il resto e' trasparente. Un fotogramma di misura unica evita un atlante a
 * misure variabili: la scena posiziona lo sprite sull'angolo dell'impronta e
 * l'impronta vera resta quella dichiarata in `data/structures.json`.
 */
export const STRUCTURE_FRAME = { width: 96, height: 64 } as const;

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
  /** L'area rivendicata dal Totem: sopra il terreno, sotto tutto il resto. */
  claim: 0.5,
  decor: 1,
  structure: 2,
  player: 10,
  /** Il fantasma della struttura in costruzione: sopra il giocatore. */
  ghost: 15,
  over: 20,
  ambient: 30,
} as const;

export function assetUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}assets/${relativePath}`;
}
