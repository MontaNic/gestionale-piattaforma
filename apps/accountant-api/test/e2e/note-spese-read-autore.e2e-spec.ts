// =============================================================================
// note-spese-read-autore.e2e-spec.ts — autore/decisore nei read path (PR-5a)
// =============================================================================
// Il pannello approvazione (PR-5) deve sapere DI CHI è la spesa e CHI l'ha
// decisa: `list`/`getById` includono `user` e `decisaDa` con **select esplicito**
// di {id, firstName, lastName}. Su `User` vivono email, hash password/PIN, TOTP
// e badge NFC → l'assenza di quei campi è asserita, non assunta.
//
// Test:
//  1. getById e list includono l'autore coi campi attesi (+ decisaDa dopo la decisione).
//  2. email e ogni altro campo User non previsto ASSENTI dal payload.
//  3. cross-tenant: la relazione user inclusa non trapela utenti di altro tenant.
// =============================================================================

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, seedMinimal, seedSecondTenant, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';
import type { DbService } from '@gestionale/db/nest';
import type { NoteSpeseService } from '../../src/note-spese/note-spese.service';
import type { CreateNotaSpesaDto } from '../../src/note-spese/dto/create-nota-spesa.dto';

interface TenantCtx {
  tenantId: string;
  isSuperAdmin: boolean;
}
function ctx(tenantId: string): TenantCtx {
  return { tenantId, isSuperAdmin: false };
}

function baseDto(over: Partial<CreateNotaSpesaDto> = {}): CreateNotaSpesaDto {
  return {
    data: '2026-07-15',
    tipoSpesa: 'vitto',
    metodoPagamento: 'contanti',
    totale: 0,
    aliquotaIva: 'iva_10',
    deducibilitaFiscale: 'd_100',
    scopoMissione: 'Trasferta test',
    ...over,
  } as CreateNotaSpesaDto;
}

// Campi di User che NON devono mai comparire nel payload di dominio.
const CAMPI_VIETATI = [
  'email',
  'passwordHash',
  'pinHash',
  'totpSecret',
  'badgeNfcId',
  'tenantId',
  'isActive',
  'aziendaId',
  'lastLoginAt',
  'failedLoginAttempts',
];

describe('Note Spese read autore E2E (PR-5a)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let db: DbService;
  let svc: NoteSpeseService;
  let makeId: () => string;
  let runIn: <T>(c: TenantCtx, fn: () => Promise<T> | T) => Promise<T>;

  beforeAll(async () => {
    containers = await startTestContainers();
    app = await createTestApp(containers);
    const dbNest = await import('@gestionale/db/nest');
    const dbPkg = await import('@gestionale/db');
    const svcMod = await import('../../src/note-spese/note-spese.service');
    db = app.get(dbNest.DbService);
    svc = app.get(svcMod.NoteSpeseService);
    makeId = dbPkg.id;
    runIn = dbPkg.runInTenantContext;
  });

  afterAll(async () => {
    await app?.close();
    await stopTestContainers(containers);
  });

  beforeEach(async () => {
    await truncateDatabase(containers.databaseUrl);
  });

  async function seedApprovatore(tenantId: string): Promise<string> {
    return runIn(ctx(tenantId), async () => {
      const u = await db.prisma.user.create({
        data: {
          id: makeId(),
          tenantId,
          email: 'direzione@studio.local',
          passwordHash: 'x',
          firstName: 'Dir',
          lastName: 'Ezione',
        },
      });
      return u.id;
    });
  }

  // ── T1 — autore (e decisore) presenti coi campi attesi ───────────────────────
  it('T1 — getById e list includono autore {id,firstName,lastName}; decisaDa dopo la decisione', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const approver = await seedApprovatore(A.tenantId);

    const nota = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );

    await runIn(ctx(A.tenantId), async () => {
      const detail = await svc.getById(A.tenantId, A.adminUserId, nota.id);
      expect(detail.user).toMatchObject({
        id: A.adminUserId,
        firstName: 'Admin',
        lastName: 'Studio',
      });
      // Non ancora decisa → decisaDa null.
      expect(detail.decisaDa).toBeNull();

      const list = await svc.list(A.tenantId, A.adminUserId, {});
      expect(list[0]!.user).toMatchObject({ id: A.adminUserId, firstName: 'Admin' });

      // Dopo la decisione, il decisore è esposto (serve al filtro stato=approvata).
      await svc.invia(A.tenantId, A.adminUserId, nota.id);
      await svc.approva(A.tenantId, approver, nota.id);
      const deciso = await svc.getById(A.tenantId, A.adminUserId, nota.id);
      expect(deciso.decisaDa).toMatchObject({ id: approver, firstName: 'Dir', lastName: 'Ezione' });
    });
  });

  // ── T2 — nessun campo User sensibile nel payload ─────────────────────────────
  it('T2 — email e ogni altro campo User non previsto sono ASSENTI (getById + list)', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const nota = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );

    await runIn(ctx(A.tenantId), async () => {
      const detail = await svc.getById(A.tenantId, A.adminUserId, nota.id);
      const list = await svc.list(A.tenantId, A.adminUserId, {});

      for (const payload of [detail.user, list[0]!.user]) {
        // Assert esplicito sull'ASSENZA, non solo sulla presenza dei tre campi.
        for (const campo of CAMPI_VIETATI) {
          expect(Object.prototype.hasOwnProperty.call(payload, campo)).toBe(false);
        }
        expect(Object.keys(payload).sort()).toEqual(['firstName', 'id', 'lastName']);
      }
    });
  });

  // ── T3 — cross-tenant: la relazione user non trapela utenti di altro tenant ──
  it('T3 — tenant B non raggiunge nota+autore di tenant A (RLS copre la relazione user)', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const B = await seedSecondTenant(containers.databaseUrl, { email: 'admin-b@studio.local' });

    const notaA = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );

    await runIn(ctx(B.tenantId), async () => {
      await expect(svc.getById(B.tenantId, B.adminUserId, notaA.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_NOT_FOUND' },
      });
      const listB = await svc.list(B.tenantId, B.adminUserId, {});
      expect(listB.find((n) => n.id === notaA.id)).toBeUndefined();
      // Nessun utente di A compare tra gli autori visibili a B.
      expect(listB.some((n) => n.user.id === A.adminUserId)).toBe(false);
    });

    // Controllo positivo: A vede il proprio autore (il 404 di B non è falso positivo).
    await runIn(ctx(A.tenantId), async () => {
      const detail = await svc.getById(A.tenantId, A.adminUserId, notaA.id);
      expect(detail.user.id).toBe(A.adminUserId);
    });
  });
});
