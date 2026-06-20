// =============================================================================
// documenti-download-isolation.e2e-spec.ts — IDOR guard sul download (ADR-0044)
// =============================================================================
// Il punto sensibile del modulo Documenti (l'analogo dell'anti-traversal per lo
// storage): il download deve essere LOAD-THEN-AUTHORIZE. L'endpoint accetta solo
// l'id del documento (MAI lo storageKey); il service carica la riga via
// findFirst({ id, tenantId }) e, se non appartiene al tenant del chiamante,
// ritorna 404 PRIMA di toccare lo StorageService — niente IDOR cross-tenant.
//
// Questo è il test che il count-isolation NON copre: il count prova che la RLS
// isola le righe, non che `getForDownload` sul path download si comporti di
// conseguenza. È la sentinella che cattura il refactor futuro "findUnique senza
// tenant / scorciatoia che serve il blob dall'id" — che lascerebbe il
// count-test verde mentre il download diventa bucato.
//
// Service-level (no HTTP/login): esercita direttamente DocumentiService.
// getForDownload dal DI container, sotto contesto RLS per tenant. La barriera
// esercitata è il filtro applicativo `where:{tenantId}` (il vettore di
// regressione). Local-only (TD-CB), come tutta la suite e2e di accountant-api.
//
// NB Discovery #30: import di @gestionale/db (+ DbService + DocumentiService che
// lo carica transitivamente) SOLO dinamici DENTRO beforeAll, dopo createTestApp
// che setta l'env — altrimenti il singleton `prisma` legge la DATABASE_URL
// placeholder al require-time e l'auth fallisce. Gli import statici sono type-only.
// =============================================================================

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, seedMinimal, seedSecondTenant, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';
import type { DbService } from '@gestionale/db/nest';
import type { DocumentiService } from '../../src/documenti/documenti.service';

interface TenantCtx {
  tenantId: string;
  isSuperAdmin: boolean;
}
function ctx(tenantId: string): TenantCtx {
  return { tenantId, isSuperAdmin: false };
}

describe('Documenti download isolation E2E — IDOR guard', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let db: DbService;
  let svc: DocumentiService;
  let makeId: () => string;
  let runIn: <T>(c: TenantCtx, fn: () => Promise<T> | T) => Promise<T>;

  beforeAll(async () => {
    containers = await startTestContainers();
    app = await createTestApp(containers);
    // Dinamici post-createTestApp (Discovery #30): ora @gestionale/db carica con
    // l'env corretto impostato dal bootstrap.
    const dbNest = await import('@gestionale/db/nest');
    const dbPkg = await import('@gestionale/db');
    const docMod = await import('../../src/documenti/documenti.service');
    db = app.get(dbNest.DbService);
    svc = app.get(docMod.DocumentiService);
    makeId = dbPkg.id;
    runIn = dbPkg.runInTenantContext;
  });

  afterAll(async () => {
    await app?.close();
    await stopTestContainers(containers);
    // File scritti dallo StorageService durante i create (root cwd/var/storage).
    await rm(join(process.cwd(), 'var', 'storage'), { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateDatabase(containers.databaseUrl);
  });

  it('tenant B cannot download tenant A document (load-then-authorize → 404 before storage)', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const B = await seedSecondTenant(containers.databaseUrl, { email: 'admin-b@studio.local' });

    // Documento reale di tenant A (la create scrive il file via StorageService).
    const doc = await runIn(ctx(A.tenantId), async () => {
      const azienda = await db.prisma.azienda.create({
        data: { id: makeId(), tenantId: A.tenantId, codice: 'AZ-A', nome: 'Az A' },
      });
      const tipo = await db.prisma.documentoTipo.create({
        data: {
          id: makeId(),
          tenantId: A.tenantId,
          nome: 'Tipo A',
          direzione: 'studio_cliente',
          visibilitaDefault: 'azienda',
        },
      });
      return svc.create(
        A.tenantId,
        A.adminUserId,
        { tipoId: tipo.id, aziendaId: azienda.id, visibilita: 'tutti' },
        {
          buffer: Buffer.from('contenuto riservato'),
          originalname: 'doc.txt',
          mimetype: 'text/plain',
        },
      );
    });

    // Cross-tenant: B NON deve raggiungere il blob → 404 (prima dello storage).
    await runIn(ctx(B.tenantId), async () => {
      await expect(svc.getForDownload(B.tenantId, doc.id)).rejects.toMatchObject({
        response: { errorCode: 'E_DOCUMENTO_NOT_FOUND' },
      });
    });

    // Controllo positivo: A raggiunge la riga (il 404 di B non è un falso positivo).
    await runIn(ctx(A.tenantId), async () => {
      const { documento, object } = await svc.getForDownload(A.tenantId, doc.id);
      expect(documento.id).toBe(doc.id);
      object.stream.destroy();
    });
  });
});
