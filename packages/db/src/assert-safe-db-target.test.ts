import { describe, expect, it } from 'vitest';

import { assertSafeDbTarget, ProdDbAccessBlockedError } from './assert-safe-db-target';

// Test PURI, deterministici, NESSUNA connessione DB. Coprono la matrice del
// guard anti-prod-da-host (TD-dev-env-punta-prod / Sub-A). Vedi STOP 1 §4.

const PROD_APP_URL = 'postgresql://gestionale_app:pw@127.0.0.1:5432/gestionale?schema=public';

describe('assertSafeDbTarget', () => {
  // 1. Il near-incident: dev server da host che eredita il .env prod.
  it('aborta su target prod con NODE_ENV unset e allow=false', () => {
    expect(() =>
      assertSafeDbTarget(PROD_APP_URL, { nodeEnv: undefined, allowProdDb: false }),
    ).toThrow(ProdDbAccessBlockedError);
  });

  // 2. Whitelist manutenzione intenzionale (seed/smoke/purge con env esplicita).
  it('non aborta su target prod se allow=true', () => {
    expect(() =>
      assertSafeDbTarget(PROD_APP_URL, { nodeEnv: undefined, allowProdDb: true }),
    ).not.toThrow();
  });

  // 3. Container prod legittimo: NODE_ENV=production disarma il guard.
  it('non aborta su target prod se NODE_ENV=production', () => {
    expect(() =>
      assertSafeDbTarget(PROD_APP_URL, { nodeEnv: 'production', allowProdDb: false }),
    ).not.toThrow();
  });

  // 4. Normalizzazione host: localhost equivale a 127.0.0.1.
  it('aborta su localhost (normalizzato come 127.0.0.1)', () => {
    expect(() =>
      assertSafeDbTarget('postgresql://u:p@localhost:5432/gestionale', {
        nodeEnv: undefined,
        allowProdDb: false,
      }),
    ).toThrow(ProdDbAccessBlockedError);
  });

  // 5. Default-port match: porta omessa == 5432.
  it('aborta su porta omessa (default 5432)', () => {
    expect(() =>
      assertSafeDbTarget('postgresql://u:p@127.0.0.1/gestionale', {
        nodeEnv: undefined,
        allowProdDb: false,
      }),
    ).toThrow(ProdDbAccessBlockedError);
  });

  // 6. Testcontainers (porta random, db gestionale_test) non falsato.
  it('non aborta sul DB effimero dei Testcontainers', () => {
    expect(() =>
      assertSafeDbTarget('postgresql://u:p@somehost:55432/gestionale_test', {
        nodeEnv: 'development',
        allowProdDb: false,
      }),
    ).not.toThrow();
  });

  // 7. Futuro dev env isolato (Sub-B): 127.0.0.1 ma porta diversa → non falso-positivo.
  it('non aborta sul futuro dev env isolato (porta diversa)', () => {
    expect(() =>
      assertSafeDbTarget('postgresql://u:p@127.0.0.1:55433/gestionale', {
        nodeEnv: 'development',
        allowProdDb: false,
      }),
    ).not.toThrow();
  });

  // 8. DB diverso sullo stesso host:porta → non è il target protetto.
  it('non aborta su un db diverso', () => {
    expect(() =>
      assertSafeDbTarget('postgresql://u:p@127.0.0.1:5432/gestionale_altrodb', {
        nodeEnv: 'development',
        allowProdDb: false,
      }),
    ).not.toThrow();
  });

  // 9. URL malformata: validare l'url non è compito del guard → no throw.
  it('non aborta su url malformata (delega il fallimento al client)', () => {
    expect(() =>
      assertSafeDbTarget('non-una-url', { nodeEnv: undefined, allowProdDb: false }),
    ).not.toThrow();
  });
});
