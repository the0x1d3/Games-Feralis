import './ui/styles.css';

import { readClock } from '@domain/world/time';
import { createGame } from '@engine/index';
import { detectLocale, setLocale } from '@i18n/index';
import { WorldScene } from '@scenes/World';
import { startSession, storageKind } from '@state/session';
import { systemClock } from '@state/systemClock';
import { mountDialog } from '@ui/dialog';
import { mountHud } from '@ui/hud';

/**
 * Punto di ingresso. Qui, e solo qui, il mondo impuro (DOM, orologio, browser)
 * incontra il resto del progetto.
 */

const GAME_VERSION = '0.2.0';

function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Elemento #${id} assente da index.html`);
  return node;
}

async function bootstrap(): Promise<void> {
  setLocale(detectLocale(navigator.languages));

  const overlay = requireElement('ui-overlay');
  const hud = mountHud(requireElement('brand'), overlay);
  const dialog = mountDialog(overlay);

  const session = await startSession({
    clock: systemClock,
    gameVersion: GAME_VERSION,
    onSaveStateChange: (savedAt) => {
      hud.setSaved(savedAt);
    },
  });

  if (storageKind() === 'localstorage') hud.showStorageWarning();

  const { store, world } = session;
  const config = world.config;
  const save = (): Promise<void> => session.save();

  const initialZone = world.zones.get(store.getState().player.zoneId);
  if (initialZone !== undefined) hud.setZone(initialZone.nameKey);
  hud.setClock(readClock(store.getState().world.gameTimeMs, config.time));

  store.subscribe((state) => {
    hud.setClock(readClock(state.world.gameTimeMs, config.time));
  });

  const game = createGame({
    parent: requireElement('game-canvas'),
    scenes: [
      new WorldScene({
        store,
        config,
        zones: world.zones,
        rawMaps: world.rawMaps,
        onSignRead: (textKey) => {
          dialog.toggle(textKey);
        },
        onZoneChanged: (zone) => {
          dialog.hide();
          hud.setZone(zone.nameKey);
          // Cambiare zona e' un momento sensato per fissare i progressi:
          // e' anche il punto in cui un giocatore chiude la scheda.
          void save();
        },
      }),
    ],
  });

  /*
   * Sonda di sviluppo.
   *
   * `import.meta.env.DEV` e' falso nella build di produzione, quindi Vite
   * elimina del tutto questo blocco: non e' un gancio di test lasciato nel
   * gioco. Serve a ispezionare lo stato dalla console e ad avanzare il ciclo a
   * mano quando la scheda e' in secondo piano — Phaser mette in pausa il game
   * loop quando la pagina non e' visibile, il che e' corretto ma rende
   * impossibile verificare qualsiasi cosa da un browser automatizzato.
   */
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__feralis'] = {
      store,
      world,
      game,
      save,
      step: (frames: number, deltaMs = 1000 / 60): void => {
        for (let i = 0; i < frames; i += 1) {
          game.step(performance.now() + i * deltaMs, deltaMs);
        }
      },
    };
  }
}

void bootstrap();
