import { BACKGROUND_COLOR, GAME_HEIGHT, GAME_WIDTH } from './config';
import { type GameConfig, Phaser, type PhaserGame } from './phaser';

export interface CreateGameOptions {
  /** Elemento che ospita il canvas. */
  readonly parent: HTMLElement;
  /** Le scene da registrare, nell'ordine di boot. */
  readonly scenes: NonNullable<GameConfig['scene']>;
}

/**
 * Crea l'istanza di gioco.
 *
 * Scelte fissate qui e non altrove:
 *  - `Phaser.AUTO`: in Phaser 4 il renderer Canvas e' deprecato, ma un fallback
 *    resta preferibile a uno schermo nero su hardware vecchio.
 *  - `pixelArt: true`: imposta automaticamente antialias off e roundPixels on,
 *    che e' esattamente cio' che serve a una pixel art 32x32.
 *  - `Scale.FIT` + `CENTER_BOTH`: risoluzione interna fissa, scalata al
 *    viewport. Il mobile in landscape (PDR §7.3) ricade nello stesso percorso.
 */
export function createGame(options: CreateGameOptions): PhaserGame {
  const config: GameConfig = {
    type: Phaser.AUTO,
    parent: options.parent,
    backgroundColor: BACKGROUND_COLOR,
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: options.scenes,
  };

  return new Phaser.Game(config);
}

/**
 * Distrugge l'istanza liberando il canvas.
 *
 * Esiste gia' in Fase 0 perche' il PDR §7.1 chiede "nessun leak: le entita'
 * distrutte devono rimuovere i listener". Avere il percorso di teardown fin
 * dall'inizio evita di ricostruirlo quando servira' davvero.
 */
export function destroyGame(game: PhaserGame): void {
  game.destroy(true);
}
