import { describe, expect, it } from 'vitest';

import {
  AuthErrorCode,
  CommonErrorCode,
  PLATFORM_ERROR_CODES,
  type PlatformErrorCode,
} from './error-codes';

// Test di parità/forma (ADR-0027 §D5 passo 3): la fonte unica dei codici
// agnostici è coerente e usabile da FE e BE. Garantisce che il set atteso non
// cambi per sbaglio e che la convenzione di naming sia rispettata.

const EXPECTED_AGNOSTIC_CODES = [
  'E_AUTH_INVALID_CREDENTIALS',
  'E_AUTH_ACCOUNT_LOCKED',
  'E_AUTH_TENANT_REQUIRED',
  'E_AUTH_TENANT_MISMATCH',
  'E_AUTH_SESSION_INVALID',
  'E_RATE_LIMITED',
  'E_VALIDATION',
  'E_UNKNOWN',
] as const;

describe('tassonomia error-code agnostica (fonte unica)', () => {
  it('espone esattamente il set atteso di codici agnostici', () => {
    expect([...PLATFORM_ERROR_CODES].sort()).toEqual([...EXPECTED_AGNOSTIC_CODES].sort());
  });

  it('ogni codice rispetta la convenzione di naming (prefix E_)', () => {
    for (const code of PLATFORM_ERROR_CODES) {
      expect(code).toMatch(/^E_[A-Z0-9_]+$/);
    }
  });

  it('non contiene duplicati', () => {
    expect(new Set(PLATFORM_ERROR_CODES).size).toBe(PLATFORM_ERROR_CODES.length);
  });

  it('non include codici di DOMINIO (restano nel verticale)', () => {
    for (const code of PLATFORM_ERROR_CODES) {
      expect(code).not.toMatch(/^E_(MENU|ARTICLE|PRICE_LIST)_/);
    }
  });

  it('valori enum stabili e usabili come PlatformErrorCode', () => {
    expect(AuthErrorCode.SESSION_INVALID).toBe('E_AUTH_SESSION_INVALID');
    expect(CommonErrorCode.UNKNOWN).toBe('E_UNKNOWN');
    const sample: PlatformErrorCode = AuthErrorCode.INVALID_CREDENTIALS;
    expect(PLATFORM_ERROR_CODES).toContain(sample);
  });
});
