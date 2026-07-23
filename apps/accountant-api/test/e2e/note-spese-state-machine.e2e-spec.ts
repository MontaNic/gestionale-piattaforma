// =============================================================================
// note-spese-state-machine.e2e-spec.ts — macchina a stati Note Spese (PR-3)
// =============================================================================
// I 5 test residui §7 (4,5,6,7,8) + T15 (DP-1/DP-2: respinta→inviata riesce e
// azzera i campi decisionali). Service-level dal DI container sotto contesto RLS
// (come note-spese-security): esercitano transizioni + gating + auto-decisione +
// immutabilità. Local-only (TD-CB).
//
// Ownership/permessi: a livello service `approva`/`respingi` NON verificano il
// permesso (è il PermissionsGuard, HTTP) — verificano solo autore≠decisore. Quindi
// un secondo utente qualunque funge da "approvatore". §7.8 verifica comportamento
// GIÀ introdotto da PR-2 (update/allegati/delete gated su stato editabile).
// =============================================================================

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, seedMinimal, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';
import type { DbService } from '@gestionale/db/nest';
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

describe('Note Spese state machine E2E (PR-3)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let db: DbService;
  let svc: NoteSpeseService;
  let alleg: NoteSpeseAllegatiService;
  let makeId: () => string;
  let runIn: <T>(c: TenantCtx, fn: () => Promise<T> | T) => Promise<T>;

  // Attori del tenant: author (autore) + approver (decisore ≠ autore).
  let tenantId: string;
  let author: string;
  let approver: string;

  beforeAll(async () => {
    containers = await startTestContainers();
    app = await createTestApp(containers);
    const dbNest = await import('@gestionale/db/nest');
    const dbPkg = await import('@gestionale/db');
    const svcMod = await import('../../src/note-spese/note-spese.service');
    const allegMod = await import('../../src/note-spese/note-spese-allegati.service');
    db = app.get(dbNest.DbService);
    svc = app.get(svcMod.NoteSpeseService);
    alleg = app.get(allegMod.NoteSpeseAllegatiService);
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
    const A = await seedMinimal(containers.databaseUrl);
    tenantId = A.tenantId;
    author = A.adminUserId;
    approver = await runIn(ctx(tenantId), async () => {
      const u = await db.prisma.user.create({
        data: {
          id: makeId(),
          tenantId,
          email: 'approver@studio.local',
          passwordHash: 'x',
          firstName: 'Dir',
          lastName: 'Ezione',
        },
      });
      return u.id;
    });
  });

  // Porta una nota fino a `inviata` (totale 0 + contanti → nessun gating richiesto).
  async function seedInviata(): Promise<string> {
    return runIn(ctx(tenantId), async () => {
      const nota = await svc.create(tenantId, author, baseDto({ totale: 0 }));
      await svc.invia(tenantId, author, nota.id);
      return nota.id;
    });
  }

  // Nota con un allegato giustificativo, portabile a inviata/approvata (per §7.8).
  async function seedWithAllegato(
    approve: boolean,
  ): Promise<{ notaId: string; allegatoId: string }> {
    return runIn(ctx(tenantId), async () => {
      const nota = await svc.create(tenantId, author, baseDto({ totale: 12.5 }));
      const al = await alleg.upload(tenantId, author, nota.id, 'giustificativo', PDF);
      await svc.invia(tenantId, author, nota.id); // giustificativo presente + contanti → ok
      if (approve) await svc.approva(tenantId, approver, nota.id);
      return { notaId: nota.id, allegatoId: al.id };
    });
  }

  // ── §7.4 — auto-approvazione + auto-rifiuto vietati ──────────────────────────
  it("T4 — l'autore non può approvare né respingere la propria nota; un altro sì", async () => {
    const notaId = await seedInviata();
    await runIn(ctx(tenantId), async () => {
      await expect(svc.approva(tenantId, author, notaId)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_AUTO_DECISIONE' },
      });
      await expect(svc.respingi(tenantId, author, notaId, 'motivo')).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_AUTO_DECISIONE' },
      });
      // Controllo positivo: il decisore (≠ autore) approva.
      const ok = await svc.approva(tenantId, approver, notaId);
      expect(ok.stato).toBe('approvata');
    });
  });

  // ── §7.5 — bozza→inviata fallisce senza giustificativo con totale>0 ──────────
  it('T5 — invia con totale>0 senza giustificativo → 422; con giustificativo → inviata', async () => {
    await runIn(ctx(tenantId), async () => {
      const nota = await svc.create(tenantId, author, baseDto({ totale: 12.5 }));
      await expect(svc.invia(tenantId, author, nota.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_GIUSTIFICATIVO_MANCANTE' },
      });
      // Il blocco si toglie caricando il giustificativo.
      await alleg.upload(tenantId, author, nota.id, 'giustificativo', PDF);
      const ok = await svc.invia(tenantId, author, nota.id);
      expect(ok.stato).toBe('inviata');
    });
  });

  // ── §7.6 — bozza→inviata fallisce senza scontrino se pagamento carta ─────────
  it('T6 — invia con carta senza scontrino POS → 422; con scontrino → inviata', async () => {
    await runIn(ctx(tenantId), async () => {
      // totale 0 → nessun giustificativo richiesto; isoliamo il vincolo scontrino.
      const nota = await svc.create(
        tenantId,
        author,
        baseDto({ totale: 0, metodoPagamento: 'carta_aziendale' }),
      );
      await expect(svc.invia(tenantId, author, nota.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_SCONTRINO_MANCANTE' },
      });
      await alleg.upload(tenantId, author, nota.id, 'scontrino_pos', PDF);
      const ok = await svc.invia(tenantId, author, nota.id);
      expect(ok.stato).toBe('inviata');
    });
  });

  // ── §7.7 — transizioni non consentite ────────────────────────────────────────
  it('T7 — approvata→*, bozza→approvata, respinta→approvata falliscono (INVALID_TRANSITION)', async () => {
    await runIn(ctx(tenantId), async () => {
      // Nota approvata.
      const approvata = await svc.create(tenantId, author, baseDto({ totale: 0 }));
      await svc.invia(tenantId, author, approvata.id);
      await svc.approva(tenantId, approver, approvata.id);
      // approvata → approvata (terminale) e approvata → respinta.
      await expect(svc.approva(tenantId, approver, approvata.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_INVALID_TRANSITION' },
      });
      await expect(svc.respingi(tenantId, approver, approvata.id, 'x')).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_INVALID_TRANSITION' },
      });

      // bozza → approvata.
      const bozza = await svc.create(tenantId, author, baseDto({ totale: 0 }));
      await expect(svc.approva(tenantId, approver, bozza.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_INVALID_TRANSITION' },
      });

      // respinta → approvata.
      const respinta = await svc.create(tenantId, author, baseDto({ totale: 0 }));
      await svc.invia(tenantId, author, respinta.id);
      await svc.respingi(tenantId, approver, respinta.id, 'da correggere');
      await expect(svc.approva(tenantId, approver, respinta.id)).rejects.toMatchObject({
        response: { errorCode: 'E_NOTASPESA_INVALID_TRANSITION' },
      });
    });
  });

  // ── §7.8 — immutabilità su inviata E approvata (verifica comportamento PR-2) ──
  it('T8 — inviata/approvata: PATCH, POST allegato, DELETE allegato, DELETE nota tutti rifiutati', async () => {
    for (const approve of [false, true]) {
      const { notaId, allegatoId } = await seedWithAllegato(approve);
      await runIn(ctx(tenantId), async () => {
        // (a) PATCH campi.
        await expect(svc.update(tenantId, author, notaId, { note: 'x' })).rejects.toMatchObject({
          response: { errorCode: 'E_NOTASPESA_NOT_EDITABLE' },
        });
        // (b) POST allegato.
        await expect(
          alleg.upload(tenantId, author, notaId, 'scontrino_pos', PDF),
        ).rejects.toMatchObject({ response: { errorCode: 'E_NOTASPESA_NOT_EDITABLE' } });
        // (c) DELETE allegato.
        await expect(alleg.remove(tenantId, author, notaId, allegatoId)).rejects.toMatchObject({
          response: { errorCode: 'E_NOTASPESA_NOT_EDITABLE' },
        });
        // (d) DELETE nota.
        await expect(svc.remove(tenantId, author, notaId)).rejects.toMatchObject({
          response: { errorCode: 'E_NOTASPESA_NOT_DELETABLE' },
        });
      });
    }
  });

  // ── DP-1/DP-2 — respinta→inviata riesce e azzera i campi decisionali ─────────
  it('T15 — respinta→inviata (correzione) riesce e azzera decisaAt/decisaDaId/motivoRifiuto', async () => {
    const notaId = await seedInviata();
    await runIn(ctx(tenantId), async () => {
      // Rifiuto: popola i campi decisionali.
      await svc.respingi(tenantId, approver, notaId, 'manca il dettaglio esercente');
      const respinta = await db.prisma.notaSpesa.findFirstOrThrow({ where: { id: notaId } });
      expect(respinta.stato).toBe('respinta');
      expect(respinta.decisaDaId).toBe(approver);
      expect(respinta.motivoRifiuto).toBe('manca il dettaglio esercente');
      expect(respinta.decisaAt).not.toBeNull();

      // Re-invio diretto dell'autore (DP-1): riesce e azzera i campi (DP-2).
      const reinviata = await svc.invia(tenantId, author, notaId);
      expect(reinviata.stato).toBe('inviata');
      expect(reinviata.decisaAt).toBeNull();
      expect(reinviata.decisaDaId).toBeNull();
      expect(reinviata.motivoRifiuto).toBeNull();
      expect(reinviata.inviataAt).not.toBeNull();
    });
  });
});
