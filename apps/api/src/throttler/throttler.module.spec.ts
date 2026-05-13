import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AUTH_STRICT_METADATA, TENANT_CREATE_METADATA } from './throttler.module';
import { extractSubFromAuthHeader } from './utils/jwt-decode.util';
import { skipIfMetadataAbsent } from './utils/skip-if-metadata.util';

// =============================================================================
// Throttler helpers spec (B1 STOP 4)
// =============================================================================
// 6 test sui due helper estratti per testability:
//   - skipIfMetadataAbsent (factory + AUTH_STRICT + TENANT_CREATE)
//   - extractSubFromAuthHeader (5 scenari di malformedness)
//
// Smoke STOP 2 copre il wiring end-to-end (guard + decorator integration).
// =============================================================================

// Helper: ExecutionContext mockato per il test di skipIfMetadataAbsent. Solo
// `getHandler()` e `getClass()` sono usati dal builder, restano gli altri stub.
function makeCtx(handler: object, cls: object): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

// Helper: costruisce JWT-like string con payload base64url-encoded. Firma
// dummy (non viene verificata).
function makeJwt(payload: Record<string, unknown>, headerB64 = 'header'): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${headerB64}.${payloadB64}.sig`;
}

describe('skipIfMetadataAbsent', () => {
  // ─── Test 1 — metadata assente → skip = true ───────────────────────────────
  it('returns true (skip throttler) when metadata flag absent on handler and class', () => {
    const handler = function authStrictHandler(): void {};
    const cls = class TestController {};
    const ctx = makeCtx(handler, cls);

    const skip = skipIfMetadataAbsent(AUTH_STRICT_METADATA);
    expect(skip(ctx)).toBe(true);
  });

  // ─── Test 2 — metadata presente su handler → skip = false ──────────────────
  it('returns false (apply throttler) when metadata flag set on handler', () => {
    const handler = function withFlag(): void {};
    Reflect.defineMetadata(AUTH_STRICT_METADATA, true, handler);
    const cls = class TestController {};
    const ctx = makeCtx(handler, cls);

    const skip = skipIfMetadataAbsent(AUTH_STRICT_METADATA);
    expect(skip(ctx)).toBe(false);
  });

  // ─── Test 3 — funziona simmetricamente per TENANT_CREATE_METADATA ─────────
  it('builder is reusable for different metadata keys (TENANT_CREATE)', () => {
    const handler = function withTenantFlag(): void {};
    Reflect.defineMetadata(TENANT_CREATE_METADATA, true, handler);
    const cls = class TenantsController {};
    const ctx = makeCtx(handler, cls);

    // Flag tenant-create attivo → tenant-create deve girare, auth-strict NO.
    expect(skipIfMetadataAbsent(TENANT_CREATE_METADATA)(ctx)).toBe(false);
    expect(skipIfMetadataAbsent(AUTH_STRICT_METADATA)(ctx)).toBe(true);
  });
});

describe('extractSubFromAuthHeader', () => {
  // ─── Test 4 — JWT valido → ritorna sub ─────────────────────────────────────
  it('extracts sub claim from well-formed Bearer JWT', () => {
    const token = makeJwt({ sub: 'user-123', tenantId: 'tenant-A', type: 'access' });
    const sub = extractSubFromAuthHeader(`Bearer ${token}`);
    expect(sub).toBe('user-123');
  });

  // ─── Test 5 — malformed JWT (non 3 parti) → undefined ─────────────────────
  it('returns undefined for malformed JWT (no dots)', () => {
    expect(extractSubFromAuthHeader('Bearer not-a-jwt')).toBeUndefined();
  });

  // ─── Test 6 — header assente → undefined ───────────────────────────────────
  it('returns undefined when authHeader is undefined', () => {
    expect(extractSubFromAuthHeader(undefined)).toBeUndefined();
    expect(extractSubFromAuthHeader(null)).toBeUndefined();
  });

  // ─── Test 7 — schema diverso da Bearer → undefined ─────────────────────────
  it('returns undefined for non-Bearer schemes', () => {
    const token = makeJwt({ sub: 'user-123' });
    expect(extractSubFromAuthHeader(`Basic ${token}`)).toBeUndefined();
  });

  // ─── Test 8 — payload senza sub → undefined ────────────────────────────────
  it('returns undefined when JWT payload has no sub claim', () => {
    const token = makeJwt({ email: 'user@x.com', type: 'access' }); // no sub
    expect(extractSubFromAuthHeader(`Bearer ${token}`)).toBeUndefined();
  });

  // ─── Test 9 — payload base64-junk → undefined (no throw) ──────────────────
  it('returns undefined when JWT payload is base64 garbage (no throw)', () => {
    expect(extractSubFromAuthHeader('Bearer header.@@@invalid@@@.sig')).toBeUndefined();
  });
});
