// =============================================================================
// comande-rls-isolation.e2e-spec.ts (KDS, ADR-attivazione-layer-comanda) — RLS
// =============================================================================
// La tabella `comande` è nuova e tenant-scoped: il GATE verde della migration NON
// prova l'isolamento. Questo spec lo ESERCITA al layer DB (Prisma extension RLS)
// bootando un client come ruolo `gestionale_app` (NOSUPERUSER, NOBYPASSRLS) → la
// policy RLS FORCE `comande_tenant_isolation` è realmente enforced (gli altri
// spec E2E girano come superuser `postgres` e bypasserebbero la policy). Pattern
// identico a conti-rls-isolation.e2e-spec.ts.
//
// Copertura:
//   1. READ isolation  — tenant B non LEGGE le Comanda di A (fail closed)
//   2. WRITE isolation — tenant B non MUTA la Comanda di A (P2025, no mutation);
//                        insert cross-tenant (tenantId=A da ctx B) bloccato
// =============================================================================

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaClient,
  runInTenantContext,
  id,
  Channel,
  PrintDepartment,
  type ExtendedPrismaClient,
} from '@gestionale/db';

import { seedMinimal, seedSecondTenant, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';

const APP_ROLE = 'gestionale_app';
const APP_ROLE_PASSWORD = 'PLACEHOLDER_MUST_BE_ROTATED';

function toAppRoleUrl(superuserUrl: string): string {
  const u = new URL(superuserUrl);
  u.username = APP_ROLE;
  u.password = APP_ROLE_PASSWORD;
  return u.toString();
}

async function rawCount(superuserUrl: string, sql: string): Promise<number> {
  const client = new Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    const res = await client.query(sql);
    return Number(res.rows[0].count);
  } finally {
    await client.end();
  }
}

/** Crea Conto + Comanda per un tenant (nel suo context RLS). */
async function seedComandaFor(
  prisma: ExtendedPrismaClient,
  tenantId: string,
): Promise<{ contoId: string; comandaId: string }> {
  return runInTenantContext({ tenantId, isSuperAdmin: false }, async () => {
    const conto = await prisma.conto.create({
      data: { id: id(), tenantId, channel: Channel.cassa },
    });
    const comanda = await prisma.comanda.create({
      data: { id: id(), tenantId, contoId: conto.id, reparto: PrintDepartment.cucina },
    });
    return { contoId: conto.id, comandaId: comanda.id };
  });
}

describe('Comande RLS isolation E2E — layer DB come gestionale_app (KDS)', () => {
  let containers: TestContainers;
  let prisma: ExtendedPrismaClient;
  let demoTenantId: string;
  let acmeTenantId: string;
  let demo: { contoId: string; comandaId: string };

  beforeAll(async () => {
    containers = await startTestContainers();
    process.env.DATABASE_URL = toAppRoleUrl(containers.databaseUrl);
    prisma = createPrismaClient();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopTestContainers(containers);
  });

  beforeEach(async () => {
    await truncateDatabase(containers.databaseUrl);
    const demoSeed = await seedMinimal(containers.databaseUrl);
    const acmeSeed = await seedSecondTenant(containers.databaseUrl);
    demoTenantId = demoSeed.tenantId;
    acmeTenantId = acmeSeed.tenantId;
    demo = await seedComandaFor(prisma, demoTenantId);
  });

  it('1a. tenant acme NON legge le Comanda di demo (findMany isolato)', async () => {
    const comandeAcme = await runInTenantContext(
      { tenantId: acmeTenantId, isSuperAdmin: false },
      () => prisma.comanda.findMany(),
    );
    expect(comandeAcme.find((c) => c.id === demo.comandaId)).toBeUndefined();
    expect(comandeAcme).toHaveLength(0);
  });

  it('1b. tenant acme NON legge la Comanda di demo per id (findUnique → null)', async () => {
    const found = await runInTenantContext({ tenantId: acmeTenantId, isSuperAdmin: false }, () =>
      prisma.comanda.findUnique({ where: { id: demo.comandaId } }),
    );
    expect(found).toBeNull();
  });

  it('2a. tenant acme NON muta la Comanda di demo (update → reject, comanda demo intatta)', async () => {
    await expect(
      runInTenantContext({ tenantId: acmeTenantId, isSuperAdmin: false }, () =>
        prisma.comanda.update({
          where: { id: demo.comandaId },
          data: { stato: 'pronta' },
        }),
      ),
    ).rejects.toThrow();

    const comandaDemo = await runInTenantContext(
      { tenantId: demoTenantId, isSuperAdmin: false },
      () => prisma.comanda.findUnique({ where: { id: demo.comandaId } }),
    );
    expect(comandaDemo?.stato).toBe('inviata');
  });

  it('2b. tenant acme NON crea una Comanda con tenantId=demo (RLS blocca)', async () => {
    await expect(
      runInTenantContext({ tenantId: acmeTenantId, isSuperAdmin: false }, () =>
        prisma.comanda.create({
          data: {
            id: id(),
            tenantId: demoTenantId,
            contoId: demo.contoId,
            reparto: PrintDepartment.bar,
          },
        }),
      ),
    ).rejects.toThrow();

    const total = await rawCount(
      containers.databaseUrl,
      `SELECT count(*)::int AS count FROM comande WHERE tenant_id = '${demoTenantId}'`,
    );
    expect(total).toBe(1); // solo quella seedata in beforeEach
  });
});
