/**
 * Costanti di presentazione del motore.
 *
 * Sono TECNICHE, non di bilanciamento: la risoluzione interna e la dimensione
 * del tile non cambiano la difficolta' del gioco, quindi non finiscono in
 * `/data`. Tutto cio' che invece tocca l'equilibrio (tempi, rese, percentuali)
 * sta nei JSON, come impone la regola 2 di CLAUDE.md.
 */

/** Tile da 32px, come da PDR §5.8. */
export const TILE_SIZE = 32;

/** Risoluzione interna: 20x15 tile. Lo scaling al viewport lo fa Phaser. */
export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 480;

/** Colore di fondo fuori dal mondo disegnato. */
export const BACKGROUND_COLOR = '#0d1411';
