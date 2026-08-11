import { afterEach, describe, expect, it } from 'vitest';
import { detectLocale, getLocale, onLocaleChange, setLocale, t } from './index';

afterEach(() => {
  setLocale('it');
});

describe('detectLocale', () => {
  it('riconosce una lingua supportata, anche con la variante regionale', () => {
    expect(detectLocale(['it-IT'])).toBe('it');
    expect(detectLocale(['en-GB'])).toBe('en');
  });

  it('scorre la lista finche non trova una lingua supportata', () => {
    expect(detectLocale(['de-DE', 'fr', 'en-US'])).toBe('en');
  });

  it('ripiega sull italiano se non riconosce nulla', () => {
    expect(detectLocale(['de', 'ja'])).toBe('it');
    expect(detectLocale([])).toBe('it');
  });
});

describe('t', () => {
  it('traduce nella lingua corrente', () => {
    setLocale('it');
    expect(t('app.tagline')).toBe('Nulla si doma davvero.');
    setLocale('en');
    expect(t('app.tagline')).toBe('Nothing is ever truly tamed.');
  });

  it('interpola i parametri', () => {
    setLocale('it');
    expect(t('hud.dayAndTime', { day: 3, time: '08:15' })).toBe('Giorno 3 · 08:15');
    setLocale('en');
    expect(t('hud.dayAndTime', { day: 3, time: '08:15' })).toBe('Day 3 · 08:15');
  });

  it('lascia intatti i segnaposto per cui non riceve un valore', () => {
    expect(t('hud.dayAndTime', { day: 1 })).toContain('{time}');
  });

  it('notifica gli ascoltatori al cambio lingua e permette di disiscriversi', () => {
    let calls = 0;
    const unsubscribe = onLocaleChange(() => {
      calls += 1;
    });

    setLocale('en');
    expect(calls).toBe(1);

    setLocale('en');
    expect(calls).toBe(1); // stessa lingua: nessuna notifica inutile

    unsubscribe();
    setLocale('it');
    expect(calls).toBe(1);
  });

  it('getLocale riflette setLocale', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
  });
});
