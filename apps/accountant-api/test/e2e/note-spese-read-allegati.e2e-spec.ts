// =============================================================================
// note-spese-read-allegati.e2e-spec.ts — allegati nei read path (PR-3a)
// =============================================================================
// getById include gli allegati (full, no storageKey); list li include leggeri
// ({id,tipo}). Service-level dal DI container sotto contesto RLS. Gli allegati
// sono inseriti via Prisma (i read path non toccano lo storage).
//
// Test:
//  1. getById di nota con 2 allegati → entrambi coi campi attesi, ordinati.
//  2. storageKey ASSENTE dal payload (getById + list) — assert sull'assenza chiave.
//  3. cross-tenant: l'include non fa trapelare allegati di altro tenant (l'include
//     eredita lo scope tenant del parent — è il punto dove potrebbe sorprendere).
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
    totale: 12.5,
    aliquotaIva: 'iva_10',
    deducibilitaFiscale: 'd_100',
    scopoMissione: 'Trasferta test',
    ...over,
  } as CreateNotaSpesaDto;
}

describe('Note Spese read allegati E2E (PR-3a)', () => {
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

  // Inserisce un allegato via Prisma (read path non tocca lo storage).
  async function seedAllegato(
    tenantId: string,
    notaSpesaId: string,
    tipo: 'giustificativo' | 'scontrino_pos',
  ): Promise<string> {
    const a = await db.prisma.notaSpesaAllegato.create({
      data: {
        id: makeId(),
        tenantId,
        notaSpesaId,
        tipo,
        storageKey: `${tenantId}/${makeId()}.pdf`,
        nomeOriginale: `${tipo}.pdf`,
        mimeType: 'application/pdf',
        dimensione: 1024,
      },
    });
    return a.id;
  }

  // ── T1 — getById espone entrambi gli allegati coi campi attesi ───────────────
  it('T1 — getById di nota con 2 allegati → entrambi presenti, campi attesi, ordinati', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const nota = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );
    await runIn(ctx(A.tenantId), async () => {
      await seedAllegato(A.tenantId, nota.id, 'scontrino_pos');
      await seedAllegato(A.tenantId, nota.id, 'giustificativo');
    });

    await runIn(ctx(A.tenantId), async () => {
      const detail = await svc.getById(A.tenantId, A.adminUserId, nota.id);
      expect(detail.allegati).toHaveLength(2);
      // Ordinamento deterministico per tipo: giustificativo prima di scontrino_pos.
      expect(detail.allegati.map((x) => x.tipo)).toEqual(['giustificativo', 'scontrino_pos']);
      const first = detail.allegati[0]!;
      expect(first).toMatchObject({
        tipo: 'giustificativo',
        nomeOriginale: 'giustificativo.pdf',
        mimeType: 'application/pdf',
        dimensione: 1024,
      });
      expect(typeof first.id).toBe('string');
      expect(first.createdAt).toBeInstanceOf(Date);
    });
  });

  // ── T2 — storageKey MAI nel payload (getById + list) ─────────────────────────
  it('T2 — storageKey assente dal payload di getById e di list', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const nota = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );
    await runIn(ctx(A.tenantId), () => seedAllegato(A.tenantId, nota.id, 'giustificativo'));

    await runIn(ctx(A.tenantId), async () => {
      const detail = await svc.getById(A.tenantId, A.adminUserId, nota.id);
      const dAll = detail.allegati[0]!;
      // Assert esplicito sull'ASSENZA della chiave (non solo presenza degli altri campi).
      expect(Object.prototype.hasOwnProperty.call(dAll, 'storageKey')).toBe(false);

      const list = await svc.list(A.tenantId, A.adminUserId, {});
      const lAll = list[0]!.allegati[0]!;
      expect(Object.prototype.hasOwnProperty.call(lAll, 'storageKey')).toBe(false);
      // list resta leggero: solo id + tipo.
      expect(Object.keys(lAll).sort()).toEqual(['id', 'tipo']);
    });
  });

  // ── T3 — cross-tenant: l'include non fa trapelare allegati di altro tenant ────
  it('T3 — tenant B non raggiunge nota+allegati di tenant A (RLS copre la relazione inclusa)', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const B = await seedSecondTenant(containers.databaseUrl, { email: 'admin-b@studio.local' });

    const notaA = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );
    await runIn(ctx(A.tenantId), () => seedAllegato(A.tenantId, notaA.id, 'giustificativo'));

    // B non vede la nota di A (né i suoi allegati): 404, nessun leak via include.
    await runIn(ctx(B.tenantId), async () => {
      await expect(svc.getById(B.tenantId, B.adminUserId, notaA.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_NOT_FOUND' },
      });
      // La lista di B non contiene la nota di A (quindi nemmeno i suoi allegati).
      const listB = await svc.list(B.tenantId, B.adminUserId, {});
      expect(listB.find((n) => n.id === notaA.id)).toBeUndefined();
    });

    // Controllo positivo: A vede la propria nota col proprio allegato (il 404 di B
    // non è un falso positivo).
    await runIn(ctx(A.tenantId), async () => {
      const detail = await svc.getById(A.tenantId, A.adminUserId, notaA.id);
      expect(detail.allegati).toHaveLength(1);
    });
  });
});
