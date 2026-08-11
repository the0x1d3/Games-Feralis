import { createRng, createStreamStates } from '@domain/rng';
import { getLocale, LOCALES, onLocaleChange, setLocale, t, type Locale } from '@i18n/index';

/**
 * Il pannello DOM sopra il canvas.
 *
 * PDR §6.1: il canvas fa il mondo, il DOM fa i pannelli. In Fase 0 il pannello
 * serve anche da prova vivente di tre cose che dovranno reggere per venti
 * giornate di lavoro: l'i18n funziona, il RNG e' deterministico, e il path base
 * arriva da `import.meta.env.BASE_URL` e non da una stringa scritta a mano.
 */

export interface OverlayHandle {
  /** Smonta il pannello e rimuove ogni listener. */
  destroy(): void;
}

interface OverlayOptions {
  /** Sorgente del seme: in Fase 1 diventera' il seme letto dal salvataggio. */
  readonly nextSeed: () => number;
}

const SEQUENCE_LENGTH = 5;

export function mountOverlay(root: HTMLElement, options: OverlayOptions): OverlayHandle {
  let seed = options.nextSeed();

  // Primo elemento focalizzabile della pagina: chi naviga da tastiera salta il
  // canvas, che non ha nulla da tabulare, e arriva ai controlli. PDR §7.2.
  const skipLink = document.createElement('a');
  skipLink.className = 'skip-link';
  skipLink.href = `#${root.id}`;
  document.body.prepend(skipLink);

  const card = element('section', 'panel');
  card.setAttribute('aria-live', 'polite');

  const heading = element('h1', 'panel__title');
  const tagline = element('p', 'panel__tagline');
  const badge = element('p', 'panel__badge');
  const hint = element('p', 'panel__hint');

  const diagTitle = element('h2', 'diag__title');
  const seedTerm = element('dt', 'diag__term');
  const seedValue = element('dd', 'diag__value');
  const streamTerm = element('dt', 'diag__term');
  const streamValue = element('dd', 'diag__value');
  const baseTerm = element('dt', 'diag__term');
  const baseValue = element('dd', 'diag__value');

  const definitions = element('dl', 'diag__list');
  definitions.append(seedTerm, seedValue, streamTerm, streamValue, baseTerm, baseValue);

  const rerollButton = document.createElement('button');
  rerollButton.type = 'button';
  rerollButton.className = 'button';

  const explain = element('p', 'diag__explain');

  const languageLabel = element('h2', 'diag__title');
  const languageGroup = element('div', 'langs');
  languageGroup.setAttribute('role', 'group');

  const languageButtons = LOCALES.map((locale) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button--ghost';
    button.dataset['locale'] = locale;
    button.addEventListener('click', () => {
      setLocale(locale);
    });
    languageGroup.append(button);
    return { locale, button };
  });

  const diagnostics = element('section', 'diag');
  diagnostics.append(diagTitle, definitions, rerollButton, explain, languageLabel, languageGroup);

  card.append(heading, tagline, badge, hint, diagnostics);
  root.append(card);

  const onReroll = (): void => {
    seed = options.nextSeed();
    render();
  };
  rerollButton.addEventListener('click', onReroll);

  function render(): void {
    skipLink.textContent = t('ui.skipToContent');
    heading.textContent = t('app.title');
    tagline.textContent = t('app.tagline');
    badge.textContent = t('boot.phase');
    hint.textContent = t('boot.hint');

    diagTitle.textContent = t('diag.title');
    seedTerm.textContent = t('diag.seed');
    seedValue.textContent = String(seed);
    streamTerm.textContent = t('diag.stream');
    streamValue.textContent = formatSequence(seed);
    baseTerm.textContent = t('diag.baseUrl');
    baseValue.textContent = import.meta.env.BASE_URL;

    rerollButton.textContent = t('diag.reroll');
    explain.textContent = t('diag.explain');
    languageLabel.textContent = t('ui.language');
    languageGroup.setAttribute('aria-label', t('ui.language'));

    const active = getLocale();
    for (const entry of languageButtons) {
      entry.button.textContent = t(localeNameKey(entry.locale));
      entry.button.setAttribute('aria-pressed', String(entry.locale === active));
    }

    document.documentElement.lang = active;
  }

  const unsubscribe = onLocaleChange(render);
  render();

  return {
    destroy(): void {
      unsubscribe();
      rerollButton.removeEventListener('click', onReroll);
      skipLink.remove();
      card.remove();
    },
  };
}

/** I primi valori dello stream "mondo": stesso seme, stessa riga di numeri. */
function formatSequence(seed: number): string {
  const rng = createRng(createStreamStates(seed).world);
  return Array.from({ length: SEQUENCE_LENGTH }, () => rng.next().toFixed(4)).join('  ');
}

function localeNameKey(locale: Locale): 'locale.it' | 'locale.en' {
  return locale === 'it' ? 'locale.it' : 'locale.en';
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
