import { onLocaleChange, t, type TranslationKey } from '@i18n/index';

/**
 * Il pannello che compare quando si legge un cartello.
 *
 * Non e' una finestra modale: bloccare il gioco per una riga di testo sarebbe
 * sproporzionato, e una modale va gestita bene (trappola del focus, ritorno al
 * punto di partenza) o non va fatta. Qui e' una regione `aria-live` che si
 * chiude con Esc o ripremendo il tasto di interazione.
 */

export interface Dialog {
  toggle(textKey: string): void;
  /**
   * Mostra un testo gia' composto.
   *
   * Serve ai messaggi con dei valori dentro — "Rugiadello ha spostato il masso"
   * — che nascono da `t()` con dei parametri e non da una chiave sola. La
   * regola "nessuna stringa hardcoded" resta: qui arriva sempre il risultato di
   * una traduzione, mai un letterale.
   */
  show(message: string): void;
  hide(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function mountDialog(root: HTMLElement): Dialog {
  const panel = document.createElement('aside');
  panel.className = 'dialog';
  panel.hidden = true;
  panel.setAttribute('aria-live', 'polite');

  const text = document.createElement('p');
  text.className = 'dialog__text';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'button button--ghost dialog__close';

  panel.append(text, close);
  root.append(panel);

  let currentKey: TranslationKey | undefined;

  function render(): void {
    close.textContent = t('dialog.close');
    if (currentKey !== undefined) text.textContent = t(currentKey);
  }

  function hide(): void {
    panel.hidden = true;
    currentKey = undefined;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !panel.hidden) hide();
  };

  close.addEventListener('click', hide);
  window.addEventListener('keydown', onKeyDown);

  const unsubscribe = onLocaleChange(render);
  render();

  return {
    toggle(textKey: string): void {
      if (!panel.hidden && currentKey === textKey) {
        hide();
        return;
      }
      currentKey = textKey as TranslationKey;
      panel.hidden = false;
      render();
    },
    show(message: string): void {
      // Testo gia' composto: non ha una chiave da ritradurre al cambio lingua,
      // quindi `currentKey` resta vuota e `render()` non lo tocca.
      currentKey = undefined;
      text.textContent = message;
      panel.hidden = false;
      close.textContent = t('dialog.close');
    },
    hide,
    isOpen: () => !panel.hidden,
    destroy(): void {
      unsubscribe();
      close.removeEventListener('click', hide);
      window.removeEventListener('keydown', onKeyDown);
      panel.remove();
    },
  };
}
