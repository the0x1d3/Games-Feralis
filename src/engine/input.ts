import type { MoveInput } from '@domain/world/movement';
import { NO_INPUT } from '@domain/world/movement';
import { Phaser } from './phaser';

/**
 * Tastiera verso l'input di dominio.
 *
 * Frecce e WASD insieme fin da subito: e' gratis, e non farlo e' il genere di
 * dettaglio che fa dire "questo gioco non e' finito" nei primi dieci secondi.
 * Il rebinding vero arriva in Fase 7 (PDR §7.2), e passera' da qui.
 */

export interface WorldInput {
  read(): MoveInput;
  /** Vero solo nel frame in cui il tasto interagisci e' stato premuto. */
  interactPressed(): boolean;
  destroy(): void;
}

export function createWorldInput(scene: Phaser.Scene): WorldInput {
  const keyboard = scene.input.keyboard;

  if (keyboard === null) {
    // Nessuna tastiera (o plugin disattivato): il gioco non deve schiantarsi.
    return { read: () => NO_INPUT, interactPressed: () => false, destroy: () => undefined };
  }

  const codes = Phaser.Input.Keyboard.KeyCodes;
  const keys = keyboard.addKeys(
    {
      up: codes.UP,
      down: codes.DOWN,
      left: codes.LEFT,
      right: codes.RIGHT,
      w: codes.W,
      a: codes.A,
      s: codes.S,
      d: codes.D,
      interactE: codes.E,
      interactSpace: codes.SPACE,
    },
    true,
    true,
  ) as Record<string, Phaser.Input.Keyboard.Key>;

  const down = (name: string): boolean => keys[name]?.isDown === true;
  const justDown = (name: string): boolean => {
    const key = keys[name];
    return key !== undefined && Phaser.Input.Keyboard.JustDown(key);
  };

  return {
    read: () => ({
      up: down('up') || down('w'),
      down: down('down') || down('s'),
      left: down('left') || down('a'),
      right: down('right') || down('d'),
    }),
    interactPressed: () => {
      // Vanno valutati entrambi: JustDown consuma lo stato, e mettere || fra i
      // due salterebbe la lettura del secondo tasto.
      const e = justDown('interactE');
      const space = justDown('interactSpace');
      return e || space;
    },
    destroy: () => {
      for (const key of Object.values(keys)) keyboard.removeKey(key, true);
    },
  };
}
