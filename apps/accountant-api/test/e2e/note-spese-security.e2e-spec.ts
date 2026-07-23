// =============================================================================
// note-spese-security.e2e-spec.ts — sicurezza + storage Note Spese (PR-2)
// =============================================================================
// Copre i test §7 in fase PR-2 (CRUD + storage): 1, 2, 3(HTTP-level 404),
// 9, 10, 11, 12, 13, 14. La state machine (4,5,6,7,8) è PR-3.
//
// Service-level (no HTTP/login), come documenti-download-isolation: esercita
// direttamente NoteSpeseService / NoteSpeseAllegatiService dal DI container sotto
// contesto RLS per tenant. La barriera esercitata è il FILTRO APPLICATIVO
// (ownership + leggi_tutte scoping + load-then-authorize + D6 + allow-list MIME) —
// il vettore di regressione che il gate DB-level (note-spese-rls-isolation) NON
// copre. Local-only (TD-CB), come tutta la suite e2e di accountant-api.
//
// NB Discovery #30: import di @gestionale/db (+ i service che lo caricano
// transitivamente) SOLO dinamici DENTRO beforeAll, dopo createTestApp che setta
// l'env — altrimenti il singleton `prisma` legge la DATABASE_URL placeholder al
// require-time. Gli import statici sono type-only.
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
import type { StorageService } from '@gestionale/platform';
import type { NoteSpeseService } from '../../src/note-spese/note-spese.service';
import type { NoteSpeseAllegatiService } from '../../src/note-spese/note-spese-allegati.service';
import type { CreateNotaSpesaDto } from '../../src/note-spese/dto/create-nota-spesa.dto';

interface TenantCtx {
  tenantId: string;
  isSuperAdmin: boolean;
}
function ctx(tenantId: string): TenantCtx {
  return { tenantId, isSuperAdmin: false };
}

// DTO base valido (bozza). I singoli test sovrascrivono i campi rilevanti.
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

const PDF = {
  buffer: Buffer.from('%PDF-1.4 test'),
  originalname: 'ricevuta.pdf',
  mimetype: 'application/pdf',
  size: 13,
};

describe('Note Spese security + storage E2E (PR-2)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let db: DbService;
  let svc: NoteSpeseService;
  let alleg: NoteSpeseAllegatiService;
  let storage: StorageService;
  let makeId: () => string;
  let runIn: <T>(c: TenantCtx, fn: () => Promise<T> | T) => Promise<T>;

  beforeAll(async () => {
    containers = await startTestContainers();
    app = await createTestApp(containers);
    // Dinamici post-createTestApp (Discovery #30).
    const dbNest = await import('@gestionale/db/nest');
    const dbPkg = await import('@gestionale/db');
    const platform = await import('@gestionale/platform');
    const svcMod = await import('../../src/note-spese/note-spese.service');
    const allegMod = await import('../../src/note-spese/note-spese-allegati.service');
    db = app.get(dbNest.DbService);
    svc = app.get(svcMod.NoteSpeseService);
    alleg = app.get(allegMod.NoteSpeseAllegatiService);
    storage = app.get(platform.StorageService);
    makeId = dbPkg.id;
    runIn = dbPkg.runInTenantContext;
  });

  afterAll(async () => {
    await app?.close();
    await stopTestContainers(containers);
    await rm(join(process.cwd(), 'var', 'storage'), { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateDatabase(containers.databaseUrl);
  });

  // Crea un secondo utente (operatore) nel tenant dato.
  async function seedUser(tenantId: string, email: string): Promise<string> {
    return runIn(ctx(tenantId), async () => {
      const u = await db.prisma.user.create({
        data: {
          id: makeId(),
          tenantId,
          email,
          passwordHash: 'x',
          firstName: 'Op',
          lastName: 'B',
        },
      });
      return u.id;
    });
  }

  // ── §7.1 — A non legge/modifica/elimina la nota di B (senza leggi_tutte) ──────
  it('T1 — utente A non accede alla nota di B (no leggi_tutte): get/update/delete → 404', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const userB = await seedUser(A.tenantId, 'op-b@studio.local');

    const notaB = await runIn(ctx(A.tenantId), () => svc.create(A.tenantId, userB, baseDto()));

    await runIn(ctx(A.tenantId), async () => {
      await expect(svc.getById(A.tenantId, A.adminUserId, notaB.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_NOT_FOUND' },
      });
      await expect(
        svc.update(A.tenantId, A.adminUserId, notaB.id, { note: 'hack' }),
      ).rejects.toMatchObject({ response: { errorCode: 'E_NOTASPESA_NOT_FOUND' } });
      await expect(svc.remove(A.tenantId, A.adminUserId, notaB.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_NOT_FOUND' },
      });
      // Controllo positivo: B raggiunge la propria nota (il 404 di A non è falso positivo).
      const own = await svc.getById(A.tenantId, userB, notaB.id);
      expect(own.id).toBe(notaB.id);
    });
  });

  // ── §7.2 — ?userId=<B> ignorato senza leggi_tutte ───────────────────────────
  it('T2 — list con filter.userId=B ignorato senza leggi_tutte (ritorna solo le proprie)', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const userB = await seedUser(A.tenantId, 'op-b@studio.local');

    const [notaA] = await runIn(ctx(A.tenantId), async () => {
      const a = await svc.create(A.tenantId, A.adminUserId, baseDto());
      await svc.create(A.tenantId, userB, baseDto()); // nota di B, non deve comparire
      return [a];
    });

    await runIn(ctx(A.tenantId), async () => {
      const list = await svc.list(A.tenantId, A.adminUserId, { userId: userB });
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(notaA?.id);
    });
  });

  // ── §7.3 — cross-tenant HTTP-level: 404 (load-then-authorize) ────────────────
  it('T3 — nota del tenant A invisibile al tenant B (getById → 404 prima dello storage)', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const B = await seedSecondTenant(containers.databaseUrl, { email: 'admin-b@studio.local' });

    const notaA = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );

    await runIn(ctx(B.tenantId), async () => {
      await expect(svc.getById(B.tenantId, B.adminUserId, notaA.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_NOT_FOUND' },
      });
    });
    await runIn(ctx(A.tenantId), async () => {
      const own = await svc.getById(A.tenantId, A.adminUserId, notaA.id);
      expect(own.id).toBe(notaA.id);
    });
  });

  // ── §7.9 — upload MIME non in allow-list → rifiutato ─────────────────────────
  it('T9 — upload MIME fuori allow-list (text/plain) → 400', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const nota = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );

    await runIn(ctx(A.tenantId), async () => {
      await expect(
        alleg.upload(A.tenantId, A.adminUserId, nota.id, 'giustificativo', {
          buffer: Buffer.from('hello'),
          originalname: 'x.txt',
          mimetype: 'text/plain',
          size: 5,
        }),
      ).rejects.toMatchObject({ response: { errorCode: 'E_NOTASPESA_ALLEGATO_MIME_INVALID' } });
    });
  });

  // ── §7.10 — upload > 20MB → rifiutato ────────────────────────────────────────
  it('T10 — upload oltre 20MB → 413 (E_ALLEGATO_TOO_LARGE dallo storage)', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const nota = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );
    const tooBig = Buffer.alloc(20 * 1024 * 1024 + 1, 0);

    await runIn(ctx(A.tenantId), async () => {
      await expect(
        alleg.upload(A.tenantId, A.adminUserId, nota.id, 'giustificativo', {
          buffer: tooBig,
          originalname: 'big.pdf',
          mimetype: 'application/pdf',
          size: tooBig.byteLength,
        }),
      ).rejects.toMatchObject({ response: { errorCode: 'E_ALLEGATO_TOO_LARGE' } });
    });
  });

  // ── §7.11 — @@unique([notaSpesaId, tipo]) → secondo giustificativo rifiutato ──
  it('T11 — secondo allegato con lo stesso tipo (giustificativo) → 409', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const nota = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );

    await runIn(ctx(A.tenantId), async () => {
      await alleg.upload(A.tenantId, A.adminUserId, nota.id, 'giustificativo', PDF);
      await expect(
        alleg.upload(A.tenantId, A.adminUserId, nota.id, 'giustificativo', PDF),
      ).rejects.toMatchObject({ response: { errorCode: 'E_NOTASPESA_ALLEGATO_TIPO_EXISTS' } });
    });
  });

  // ── §7.12 — delete allegato rimuove ANCHE l'oggetto dallo storage ────────────
  it('T12 — delete allegato cancella la riga E il file su storage', async () => {
    const A = await seedMinimal(containers.databaseUrl);
    const nota = await runIn(ctx(A.tenantId), () =>
      svc.create(A.tenantId, A.adminUserId, baseDto()),
    );

    await runIn(ctx(A.tenantId), async () => {
      const created = await alleg.upload(A.tenantId, A.adminUserId, nota.id, 'giustificativo', PDF);
      // Pre-delete: il file esiste (storage.get risolve).
      const before = await storage.get(created.storageKey, created.mimeType);
      before.stream.destroy();

      await alleg.remove(A.tenantId, A.adminUserId, nota.id, created.id);

      // Post-delete: il file NON esiste più (storage.get rigetta).
      await expect(storage.get(created.storageKey, created.mimeType)).rejects.toBeTruthy();
    });
  });

  // ── §7.13 — mandatoId di azienda ≠ aziendaId dichiarato → rifiutato ──────────
  it('T13 — mandato di azienda X con aziendaId=Y → 400 MANDATO_AZIENDA_MISMATCH', async () => {
    const A = await seedMinimal(containers.databaseUrl);

    const { aziendaY, mandatoX } = await runIn(ctx(A.tenantId), async () => {
      const azX = await db.prisma.azienda.create({
        data: { id: makeId(), tenantId: A.tenantId, codice: 'AZ-X', nome: 'Az X' },
      });
      const azY = await db.prisma.azienda.create({
        data: { id: makeId(), tenantId: A.tenantId, codice: 'AZ-Y', nome: 'Az Y' },
      });
      const prev = await db.prisma.preventivo.create({
        data: {
          id: makeId(),
          tenantId: A.tenantId,
          aziendaId: azX.id,
          codice: 'PREV-X',
          oggetto: 'Incarico X',
        },
      });
      const man = await db.prisma.mandato.create({
        data: {
          id: makeId(),
          tenantId: A.tenantId,
          preventivoId: prev.id,
          aziendaId: azX.id,
          codice: 'RDL-X',
        },
      });
      return { aziendaY: azY, mandatoX: man };
    });

    await runIn(ctx(A.tenantId), async () => {
      await expect(
        svc.create(
          A.tenantId,
          A.adminUserId,
          baseDto({ aziendaId: aziendaY.id, mandatoId: mandatoX.id }),
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'E_NOTASPESA_MANDATO_AZIENDA_MISMATCH' } });
    });
  });

  // ── §7.14 — mandatoId valorizzato con aziendaId = NULL → rifiutato ───────────
  it('T14 — mandatoId senza aziendaId → 400 MANDATO_AZIENDA_MISMATCH', async () => {
    const A = await seedMinimal(containers.databaseUrl);

    await runIn(ctx(A.tenantId), async () => {
      await expect(
        svc.create(A.tenantId, A.adminUserId, baseDto({ mandatoId: makeId() })),
      ).rejects.toMatchObject({ response: { errorCode: 'E_NOTASPESA_MANDATO_AZIENDA_MISMATCH' } });
    });
  });
});
