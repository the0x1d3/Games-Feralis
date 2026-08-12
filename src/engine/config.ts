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

/**
 * Risoluzione interna, 16:9. Lo scaling al viewport lo fa Phaser.
 *
 * Era 640x480 fino alla Fase 4: su un monitor da scrivania il gioco stava in un
 * francobollo con l'interfaccia impilata sotto. Ora il canvas riempie la finestra
 * e i pannelli ci stanno **dentro**.
 */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/**
 * Zoom della camera del mondo.
 *
 * A 1x una risoluzione da 1280x720 mostrerebbe quasi tutta la mappa (40x30
 * tile) e i Ferali diventerebbero puntini. A 1.5x se ne vedono ~27x15: la
 * stessa altezza di prima, piu' larghezza, e i pixel restano interi e nitidi
 * perche' `pixelArt: true` tiene `roundPixels` acceso.
 */
export const CAMERA_ZOOM = 1.5;

/** Colore di fondo fuori dal mondo disegnato. */
export const BACKGROUND_COLOR = '#0d1411';
