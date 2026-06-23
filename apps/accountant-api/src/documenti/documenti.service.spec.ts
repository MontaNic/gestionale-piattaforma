// =============================================================================
// documenti.service.spec.ts (ADR-0046) — unit test ACL lettore cliente (portale)
// =============================================================================
// Mocka DbService.prisma + StorageService (no DB/filesystem reale). Copre il
// predicato di visibilità cliente (`clienteWhere`) che instrada list/download:
// admin → tutti+azienda, utente → solo tutti, scoping per-azienda, e il 404
// "fail-closed" del download per documento fuori ACL. Il filtro soft-delete è
// dell'extension Prisma (testato altrove) e qui è implicito (where senza
// `deletedAt`).
// =============================================================================

import { NotFoundException } from '@nestjs/common';
import { ClienteRuolo, VisibilitaDocumento } from '@gestionale/db';
import type { DbService } from '@gestionale/db/nest';
import type { StorageService } from '@gestionale/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentiService } from './documenti.service';

function makeDeps() {
  const documento = { findMany: vi.fn(), findFirst: vi.fn() };
  const db = { prisma: { documento } } as unknown as DbService;
  const storage = { get: vi.fn() } as unknown as StorageService;
  return { db, storage, documento };
}

const TENANT = 'tenant-1';
const AZIENDA = 'azienda-1';

describe('DocumentiService — ACL lettore cliente (portale)', () => {
  let svc: DocumentiService;
  let documento: ReturnType<typeof makeDeps>['documento'];
  let storage: StorageService;

  beforeEach(() => {
    const m = makeDeps();
    svc = new DocumentiService(m.db, m.storage);
    documento = m.documento;
    storage = m.storage;
  });

  describe('listForCliente — predicato visibilità', () => {
    it('admin: nessun filtro visibilita (vede tutti + azienda), scopato a tenant+azienda', async () => {
      documento.findMany.mockResolvedValue([]);
      await svc.listForCliente(TENANT, AZIENDA, ClienteRuolo.admin);

      const where = documento.findMany.mock.calls[0]?.[0]?.where;
      expect(where).toEqual({ tenantId: TENANT, aziendaId: AZIENDA });
      expect(where).not.toHaveProperty('visibilita');
    });

    it('utente: filtra visibilita=tutti (azienda escluso), scopato a tenant+azienda', async () => {
      documento.findMany.mockResolvedValue([]);
      await svc.listForCliente(TENANT, AZIENDA, ClienteRuolo.utente);

      expect(documento.findMany.mock.calls[0]?.[0]?.where).toEqual({
        tenantId: TENANT,
        aziendaId: AZIENDA,
        visibilita: VisibilitaDocumento.tutti,
      });
    });

    it('clienteRuolo null: trattato come non-admin (solo tutti) — fail-closed', async () => {
      documento.findMany.mockResolvedValue([]);
      await svc.listForCliente(TENANT, AZIENDA, null);

      expect(documento.findMany.mock.calls[0]?.[0]?.where).toMatchObject({
        visibilita: VisibilitaDocumento.tutti,
      });
    });

    it('mappa alla vista cliente (tipoNome dal join; NO storageKey/createdBy/tenantId)', async () => {
      documento.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          tenantId: TENANT,
          aziendaId: AZIENDA,
          tipoId: 'tipo-1',
          nomeOriginale: 'F24.pdf',
          storageKey: 'opaque-key',
          mimeType: 'application/pdf',
          dimensione: 1234,
          visibilita: VisibilitaDocumento.tutti,
          note: null,
          createdBy: 'user-studio',
          deletedAt: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          tipo: { nome: 'F24 da pagare' },
        },
      ]);

      const [view] = await svc.listForCliente(TENANT, AZIENDA, ClienteRuolo.admin);
      expect(view).toEqual({
        id: 'doc-1',
        nomeOriginale: 'F24.pdf',
        mimeType: 'application/pdf',
        dimensione: 1234,
        visibilita: VisibilitaDocumento.tutti,
        note: null,
        createdAt: new Date('2026-01-01'),
        tipoNome: 'F24 da pagare',
      });
      expect(view).not.toHaveProperty('storageKey');
      expect(view).not.toHaveProperty('createdBy');
      expect(view).not.toHaveProperty('tenantId');
    });
  });

  describe('getForDownloadCliente — ACL dentro la query', () => {
    it('utente: la findFirst include id + visibilita=tutti (no leak per id fuori ACL)', async () => {
      documento.findFirst.mockResolvedValue({
        id: 'doc-1',
        storageKey: 'opaque-key',
        mimeType: 'application/pdf',
        nomeOriginale: 'F24.pdf',
      });
      vi.mocked(storage.get).mockResolvedValue({
        stream: {} as never,
        size: 10,
        mimeType: 'application/pdf',
      });

      await svc.getForDownloadCliente(TENANT, AZIENDA, ClienteRuolo.utente, 'doc-1');

      expect(documento.findFirst.mock.calls[0]?.[0]?.where).toEqual({
        tenantId: TENANT,
        aziendaId: AZIENDA,
        visibilita: VisibilitaDocumento.tutti,
        id: 'doc-1',
      });
    });

    it('documento fuori ACL / inesistente → 404 E_DOCUMENTO_NOT_FOUND', async () => {
      documento.findFirst.mockResolvedValue(null);

      await expect(
        svc.getForDownloadCliente(TENANT, AZIENDA, ClienteRuolo.admin, 'doc-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.get).not.toHaveBeenCalled();
    });
  });
});
