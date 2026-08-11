import './ui/styles.css';

import { createGame } from '@engine/index';
import { detectLocale, setLocale } from '@i18n/index';
import { BootScene } from '@scenes/Boot';
import { systemClock } from '@state/systemClock';
import { mountOverlay } from '@ui/overlay';

/**
 * Punto di ingresso. Qui, e solo qui, il mondo impuro (DOM, orologio, browser)
 * incontra il resto del progetto.
 */

function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Elemento #${id} assente da index.html`);
  }
  return node;
}

/**
 * Seme della partita. In Fase 1 arrivera' dal salvataggio (e sara' stabile fra
 * le sessioni); per ora si deriva dall'orologio, che e' comunque preferibile a
 * `Math.random()`: mantiene un solo punto in tutto il progetto in cui nasce
 * l'entropia.
 */
function seedFromClock(): number {
  return systemClock.now() >>> 0;
}

function bootstrap(): void {
  setLocale(detectLocale(navigator.languages));

  mountOverlay(requireElement('ui-overlay'), { nextSeed: seedFromClock });

  createGame({
    parent: requireElement('game-canvas'),
    scenes: [BootScene],
  });
}

bootstrap();
