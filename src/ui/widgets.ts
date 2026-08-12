/**
 * I mattoni comuni dei pannelli DOM.
 *
 * Tutto è fatto di elementi veri — `<button>`, `<ul>`, `<h2>` — e non di `div`
 * travestiti: la navigazione da tastiera e i lettori di schermo funzionano
 * perché gli elementi sono quelli giusti, non perché qualcuno ha aggiunto dei
 * gestori. È il criterio di accessibilità che il PDR §10 chiede dalla Fase 3.
 */

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** Un elemento con del testo dentro, che è il 90% di quel che serve. */
export function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content: string,
): HTMLElementTagNameMap[K] {
  const node = element(tag, className);
  node.textContent = content;
  return node;
}

export function ghostButton(
  label: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'button button--ghost panel__action';
  node.textContent = label;
  node.disabled = disabled;
  node.addEventListener('click', onClick);
  return node;
}

/** Barra di riempimento: il valore è una frazione fra 0 e 1. */
export function bar(className: string, ratio: number): HTMLElement {
  const track = element('div', `bar ${className}`);
  const fill = element('span', 'bar__fill');
  fill.style.width = `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%`;
  track.append(fill);
  return track;
}
