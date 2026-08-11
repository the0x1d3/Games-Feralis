import en from '@data/locales/en.json';
import it from '@data/locales/it.json';

/**
 * i18n minimale, ma attivo dalla Fase 0.
 *
 * Il PDR chiede IT+EN "dal day one" con le stringhe esternalizzate. Rimandare
 * l'i18n alla Fase 7, come suggerirebbe la roadmap, significherebbe fare
 * archeologia su 20 giornate di codice: la disciplina costa nulla adesso e
 * moltissimo dopo. Le chiavi sono piatte e con i punti, perche' cosi'
 * `scripts/validate-data.ts` puo' verificarle con un confronto secco.
 */

export const LOCALES = ['it', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/** L'italiano e' la lingua di riferimento: definisce l'insieme delle chiavi valide. */
export type TranslationKey = keyof typeof it;

export type TranslationParams = Readonly<Record<string, string | number>>;

const FALLBACK_LOCALE: Locale = 'it';

const BUNDLES: Record<Locale, Readonly<Record<string, string>>> = { it, en };

let currentLocale: Locale = FALLBACK_LOCALE;

const listeners = new Set<() => void>();

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Sceglie la lingua dalle preferenze del browser. Prende una lista come
 * argomento invece di leggere `navigator` da sola: cosi' resta testabile.
 */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base !== undefined && isLocale(base)) return base;
  }
  return FALLBACK_LOCALE;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  for (const listener of listeners) listener();
}

/** Registra un ascoltatore e restituisce la funzione per disiscriverlo. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Traduce. Se la chiave manca nella lingua corrente ripiega sull'italiano, e se
 * manca anche li' restituisce la chiave stessa: meglio vedere `boot.hint` a
 * schermo che una stringa vuota che nessuno nota fino alla release.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = BUNDLES[currentLocale][key] ?? BUNDLES[FALLBACK_LOCALE][key];
  if (template === undefined) return key;
  return params === undefined ? template : interpolate(template, params);
}

function interpolate(template: string, params: TranslationParams): string {
  let output = template;
  for (const [name, value] of Object.entries(params)) {
    output = output.replaceAll(`{${name}}`, String(value));
  }
  return output;
}
