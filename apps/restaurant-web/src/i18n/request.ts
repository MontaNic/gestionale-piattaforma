import { createI18nRequestConfig } from '@gestionale/i18n/request';

// =============================================================================
// i18n/request.ts — entrypoint next-intl per apps/restaurant-web (ADR-0027 §D5 passo 4)
// =============================================================================
// Il meccanismo (risoluzione cookie NEXT_LOCALE + fallback) vive in
// `@gestionale/i18n`; qui l'app inietta solo i propri messaggi — contenuto del
// verticale ristorazione, NON core. `createNextIntlPlugin` punta a questo file
// (vedi next.config.mjs) e ne usa il default export.
// =============================================================================

export default createI18nRequestConfig(
  async (locale) => (await import(`./messages/${locale}.json`)).default,
);
