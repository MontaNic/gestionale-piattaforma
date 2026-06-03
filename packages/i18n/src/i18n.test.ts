import { describe, expect, it, vi } from 'vitest';

import { defaultLocale, isValidLocale, locales } from './config';
import { buildI18nRequestConfig, resolveLocale, type LoadMessages } from './resolve';

// =============================================================================
// Test del meccanismo i18n: switch locale + fallback (ADR-0027 §D5 passo 4).
// Esercita la logica pura senza next/headers — il valore cookie grezzo è
// iniettato direttamente, come farebbe `request.ts` in produzione.
// =============================================================================

describe('isValidLocale', () => {
  it('accetta le locale supportate', () => {
    for (const loc of locales) expect(isValidLocale(loc)).toBe(true);
  });

  it('rifiuta valori fuori whitelist, undefined e stringa vuota', () => {
    expect(isValidLocale('xx')).toBe(false);
    expect(isValidLocale('IT')).toBe(false); // case-sensitive
    expect(isValidLocale(undefined)).toBe(false);
    expect(isValidLocale('')).toBe(false);
  });
});

describe('resolveLocale — switch + fallback', () => {
  it('switch: restituisce la locale richiesta quando valida', () => {
    expect(resolveLocale('it')).toBe('it');
    expect(resolveLocale('en')).toBe('en');
  });

  it('fallback al defaultLocale quando assente', () => {
    expect(resolveLocale(undefined)).toBe(defaultLocale);
  });

  it('fallback al defaultLocale quando non valido o vuoto', () => {
    expect(resolveLocale('xx')).toBe(defaultLocale);
    expect(resolveLocale('')).toBe(defaultLocale);
    expect(resolveLocale('EN')).toBe(defaultLocale); // case mismatch
  });
});

describe('buildI18nRequestConfig — carica i messaggi della locale risolta', () => {
  const loader: LoadMessages = vi.fn(async (locale) => ({ _loaded: locale }) as never);

  it('switch en: risolve la locale e carica i messaggi corrispondenti', async () => {
    const cfg = await buildI18nRequestConfig('en', loader);
    expect(cfg.locale).toBe('en');
    expect(loader).toHaveBeenCalledWith('en');
    expect(cfg.messages).toEqual({ _loaded: 'en' });
  });

  it('fallback: cookie invalido → carica i messaggi del defaultLocale', async () => {
    const cfg = await buildI18nRequestConfig('xx', loader);
    expect(cfg.locale).toBe(defaultLocale);
    expect(loader).toHaveBeenCalledWith(defaultLocale);
  });

  it('fallback: cookie assente → carica i messaggi del defaultLocale', async () => {
    const cfg = await buildI18nRequestConfig(undefined, loader);
    expect(cfg.locale).toBe(defaultLocale);
  });
});
