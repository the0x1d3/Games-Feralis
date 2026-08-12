import { onLocaleChange, t, type TranslationKey } from '@i18n/index';
import { element } from './widgets';

/**
 * La schermata di ingresso.
 *
 * Sta **dentro** il palcoscenico, sopra il canvas: è la prima cosa che si vede
 * aprendo la pagina, e sparisce al primo clic. Serve a tre cose, in ordine di
 * importanza:
 *
 *  1. dire in due righe che gioco è, prima che qualcuno debba indovinarlo;
 *  2. dare un gesto esplicito di avvio — servirà all'audio in Fase 7, che i
 *     browser non fanno partire senza un'interazione dell'utente;
 *  3. coprire il caricamento, che altrimenti sarebbe un rettangolo nero.
 *
 * Il pulsante resta disabilitato finché la sessione non è pronta: promettere
 * "Gioca" e poi non partire è peggio che aspettare mezzo secondo.
 */

export interface Landing {
  /** La sessione è caricata: il pulsante si accende. */
  setReady(): void;
  hide(): void;
  destroy(): void;
}

const PILLARS: readonly TranslationKey[] = [
  'landing.pillar.explore',
  'landing.pillar.collect',
  'landing.pillar.automate',
];

export function mountLanding(root: HTMLElement, onPlay: () => void): Landing {
  const card = element('div', 'landing__card');
  const title = element('h1', 'landing__title');
  const tagline = element('p', 'landing__tagline');
  const pitch = element('p', 'landing__pitch');

  const pillars = element('ul', 'landing__pillars');
  const pillarItems = PILLARS.map((key) => {
    const item = element('li', 'landing__pillar');
    pillars.append(item);
    return { key, item };
  });

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'button landing__play';
  play.disabled = true;
  play.addEventListener('click', () => {
    onPlay();
  });

  const controls = element('p', 'landing__controls');
  const free = element('p', 'landing__free');

  card.append(title, tagline, pitch, pillars, play, controls, free);
  root.append(card);

  let ready = false;

  function render(): void {
    title.textContent = t('app.title');
    tagline.textContent = t('app.tagline');
    pitch.textContent = t('landing.pitch');
    for (const entry of pillarItems) entry.item.textContent = t(entry.key);
    play.textContent = ready ? t('landing.play') : t('landing.loading');
    controls.textContent = t('hud.controls');
    free.textContent = t('landing.free');
  }

  const unsubscribe = onLocaleChange(render);
  render();

  return {
    setReady(): void {
      ready = true;
      play.disabled = false;
      render();
      play.focus();
    },
    hide(): void {
      root.hidden = true;
    },
    destroy(): void {
      unsubscribe();
      card.remove();
    },
  };
}
