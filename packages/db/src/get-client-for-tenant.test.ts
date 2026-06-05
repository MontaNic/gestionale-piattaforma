import { describe, expect, it } from 'vitest';

import { getClientForTenant, prisma } from './index';
import type { TenantContext } from './rls';

// Contratto fase 1 di `getClientForTenant` (ADR-0026 §D3 / addendum 8b-2):
// indirezione additiva che ritorna SEMPRE il singleton condiviso, ignorando il
// ctx. Questi test fissano quel contratto — quando la fase 2 introdurrà il
// routing reale, dovranno essere aggiornati deliberatamente (non per sbaglio).

const ctxA: TenantContext = {
  tenantId: '019e1ec8-7271-77f4-a377-6c6146726a83',
  isSuperAdmin: false,
};
const ctxB: TenantContext = {
  tenantId: '019e42dc-6b54-7f76-8c25-77430f4e89a8',
  isSuperAdmin: false,
};
const ctxSystem: TenantContext = { tenantId: null, isSuperAdmin: true };

describe('getClientForTenant (fase 1)', () => {
  it('ritorna la stessa istanza del singleton `prisma` condiviso', () => {
    expect(getClientForTenant(ctxA)).toBe(prisma);
  });

  it('ignora il ctx: stessa istanza per tenant diversi e per system context', () => {
    const a = getClientForTenant(ctxA);
    const b = getClientForTenant(ctxB);
    const sys = getClientForTenant(ctxSystem);
    expect(a).toBe(b);
    expect(b).toBe(sys);
    expect(a).toBe(prisma);
  });

  it('ritorna un client Prisma reale (ha `$transaction`)', () => {
    expect(typeof getClientForTenant(ctxA).$transaction).toBe('function');
  });
});
