import { describe, expect, it } from 'vitest';

import { allowsDevData, assertValidNodeEnv, InvalidNodeEnvError } from './assert-valid-node-env';

// Test PURI, deterministici, NESSUNA connessione DB. Coprono la matrice del
// guard fail-closed su NODE_ENV nel seed. Vedi ADR-0080.

describe('assertValidNodeEnv', () => {
  // Il caso reale: `.env` non contiene NODE_ENV e lo script non la forzava.
  it('aborta se NODE_ENV e assente', () => {
    expect(() => assertValidNodeEnv(undefined)).toThrow(InvalidNodeEnvError);
  });

  it('aborta sulla stringa vuota', () => {
    expect(() => assertValidNodeEnv('')).toThrow(InvalidNodeEnvError);
  });

  it.each(['production', 'development', 'test'] as const)('accetta %s e lo ritorna', (env) => {
    expect(assertValidNodeEnv(env)).toBe(env);
  });

  // Valore plausibile ma errato: e' il modo in cui un fail-closed "quasi giusto"
  // rientrerebbe dalla finestra.
  it("aborta su 'prod' (abbreviazione plausibile, non ammessa)", () => {
    expect(() => assertValidNodeEnv('prod')).toThrow(InvalidNodeEnvError);
  });

  it("aborta su 'Production' (confronto case-sensitive)", () => {
    expect(() => assertValidNodeEnv('Production')).toThrow(InvalidNodeEnvError);
  });

  it("aborta su 'staging' (ambiente non previsto, non un sinonimo da indovinare)", () => {
    expect(() => assertValidNodeEnv('staging')).toThrow(InvalidNodeEnvError);
  });

  // D4: il messaggio deve nominare entrambi i gesti, non solo l'errore.
  it('il messaggio nomina sia il comando dev sia quello prod', () => {
    let msg = '';
    try {
      assertValidNodeEnv(undefined);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('db:seed');
    expect(msg).toContain('db:seed:prod');
    expect(msg).toContain('NODE_ENV=development');
    expect(msg).toContain('NODE_ENV=production');
  });
});

describe('allowsDevData', () => {
  // Espresso in positivo su un set chiuso: il ramo dev non deve essere
  // raggiungibile per esclusione da 'production'.
  it('consente i dati dev in development e test', () => {
    expect(allowsDevData('development')).toBe(true);
    expect(allowsDevData('test')).toBe(true);
  });

  it('NON consente i dati dev in production', () => {
    expect(allowsDevData('production')).toBe(false);
  });
});
