import { formatClock, type DayPhase, type WorldClock } from '@domain/world/time';
import {
  getLocale,
  LOCALES,
  onLocaleChange,
  setLocale,
  t,
  type Locale,
  type TranslationKey,
} from '@i18n/index';

/**
 * La HUD, in DOM sopra il canvas (PDR §6.1).
 *
 * In DOM e non dentro Phaser perche' e' testo: cosi' e' selezionabile,
 * leggibile da uno screen reader, scalabile con la dimensione del carattere e
 * si stila in CSS invece che a colpi di coordinate.
 */

export interface Hud {
  setZone(nameKey: string): void;
  setClock(clock: WorldClock): void;
  /** `undefined` mentre il salvataggio e' in corso. */
  setSaved(at: number | undefined): void;
  showStorageWarning(): void;
  destroy(): void;
}

const PHASE_KEY: Readonly<Record<DayPhase, TranslationKey>> = {
  dawn: 'hud.phase.dawn',
  day: 'hud.phase.day',
  dusk: 'hud.phase.dusk',
  night: 'hud.phase.night',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function localeNameKey(locale: Locale): TranslationKey {
  return locale === 'it' ? 'locale.it' : 'locale.en';
}

export function mountHud(brandRoot: HTMLElement, root: HTMLElement): Hud {
  const skipLink = document.createElement('a');
  skipLink.className = 'skip-link';
  skipLink.href = `#${root.id}`;
  document.body.prepend(skipLink);

  const brandTitle = element('h1', 'brand__title');
  const brandTagline = element('p', 'brand__tagline');
  brandRoot.append(brandTitle, brandTagline);

  const bar = element('section', 'hud');
  const zoneLabel = element('span', 'hud__label');
  const zoneValue = element('strong', 'hud__value');
  const zoneBlock = element('div', 'hud__block');
  zoneBlock.append(zoneLabel, zoneValue);

  const timeLabel = element('span', 'hud__label');
  const timeValue = element('strong', 'hud__value');
  const timeBlock = element('div', 'hud__block');
  timeBlock.append(timeLabel, timeValue);

  const phaseBadge = element('span', 'hud__phase');

  const saveState = element('span', 'hud__save');
  saveState.setAttribute('aria-live', 'polite');

  bar.append(zoneBlock, timeBlock, phaseBadge, saveState);

  const hint = element('p', 'hint');
  const warning = element('p', 'warning');
  warning.hidden = true;
  warning.setAttribute('role', 'status');

  const languageGroup = element('div', 'langs');
  languageGroup.setAttribute('role', 'group');
  const languageButtons = LOCALES.map((locale) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button--ghost';
    button.addEventListener('click', () => {
      setLocale(locale);
    });
    languageGroup.append(button);
    return { locale, button };
  });

  const footer = element('div', 'footer');
  footer.append(hint, languageGroup);

  root.append(bar, warning, footer);

  /* Stato mostrato, tenuto qui perche' al cambio lingua va ridisegnato tutto. */
  let zoneNameKey: TranslationKey | undefined;
  let clock: WorldClock | undefined;
  let savedAt: number | undefined;
  let saving = false;
  let warningVisible = false;

  function renderSaveState(): void {
    if (saving) {
      saveState.textContent = t('hud.saving');
      return;
    }
    saveState.textContent = savedAt === undefined ? '' : t('hud.saved');
  }

  function render(): void {
    skipLink.textContent = t('ui.skipToContent');
    brandTitle.textContent = t('app.title');
    brandTagline.textContent = t('app.tagline');
    languageGroup.setAttribute('aria-label', t('ui.language'));
    zoneLabel.textContent = t('hud.zone');
    timeLabel.textContent = t('hud.time');
    hint.textContent = t('hud.controls');
    warning.textContent = t('storage.fallback');
    warning.hidden = !warningVisible;

    zoneValue.textContent = zoneNameKey === undefined ? '' : t(zoneNameKey);

    if (clock !== undefined) {
      timeValue.textContent = t('hud.dayAndTime', {
        day: clock.day,
        time: formatClock(clock),
      });
      phaseBadge.textContent = t(PHASE_KEY[clock.phase]);
      phaseBadge.dataset['phase'] = clock.phase;
    }

    renderSaveState();

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
    setZone(nameKey: string): void {
      zoneNameKey = nameKey as TranslationKey;
      render();
    },
    setClock(next: WorldClock): void {
      // Ridisegnare solo al cambio di minuto: la HUD non deve toccare il DOM
      // sessanta volte al secondo per mostrare lo stesso testo.
      if (clock?.minute === next.minute && clock.day === next.day) return;
      clock = next;
      render();
    },
    setSaved(at: number | undefined): void {
      saving = at === undefined;
      if (at !== undefined) savedAt = at;
      renderSaveState();
    },
    showStorageWarning(): void {
      warningVisible = true;
      render();
    },
    destroy(): void {
      unsubscribe();
      skipLink.remove();
      brandTitle.remove();
      brandTagline.remove();
      bar.remove();
      warning.remove();
      footer.remove();
    },
  };
}
