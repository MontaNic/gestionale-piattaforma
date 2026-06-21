// =============================================================================
// circolari.service.spec.ts (ADR-0045) — unit test macchina di stato + validazione
// =============================================================================
// Mocka DbService.prisma (no DB reale). Copre i guard di transizione (publish/
// delete) e le regole cross-field destinatari, che la ValidationPipe NON copre
// in e2e (TD-BS Sub-2). Il CRUD happy-path (create/update con tx atomica) è
// coperto dagli e2e (circolari-crud.e2e-spec.ts).
// =============================================================================

import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CircolareStato } from '@gestionale/db';
import type { DbService } from '@gestionale/db/nest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircolariService } from './circolari.service';
import type { CreateCircolareDto } from './dto/create-circolare.dto';

function makeDb() {
  const circolare = { findFirst: vi.fn(), update: vi.fn() };
  const azienda = { findMany: vi.fn() };
  const db = { prisma: { circolare, azienda } } as unknown as DbService;
  return { db, circolare, azienda };
}

/** Cattura l'eccezione lanciata da una promise (o null se risolve). */
async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

function errorCodeOf(e: unknown): string | undefined {
  const res = (e as { getResponse?: () => unknown }).getResponse?.();
  return (res as { errorCode?: string } | undefined)?.errorCode;
}

const TENANT = 'tenant-1';

describe('CircolariService — macchina di stato', () => {
  let svc: CircolariService;
  let circolare: ReturnType<typeof makeDb>['circolare'];

  beforeEach(() => {
    const m = makeDb();
    svc = new CircolariService(m.db);
    circolare = m.circolare;
  });

  it('publish() su bozza → stato=pubblicata + pubblicataIl valorizzata', async () => {
    circolare.findFirst.mockResolvedValue({ id: 'c1', stato: CircolareStato.bozza });
    circolare.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'c1', ...data }),
    );

    const res = (await svc.publish(TENANT, 'c1')) as { stato: string; pubblicataIl: unknown };

    expect(res.stato).toBe(CircolareStato.pubblicata);
    // mockImplementation riflette il `data` passato a update() → la transizione
    // ha settato stato=pubblicata + pubblicataIl come Date.
    expect(res.pubblicataIl).toBeInstanceOf(Date);
    expect(circolare.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ stato: CircolareStato.pubblicata }),
      }),
    );
  });

  it('publish() su già pubblicata → 422 E_CIRCOLARE_NOT_BOZZA', async () => {
    circolare.findFirst.mockResolvedValue({ id: 'c1', stato: CircolareStato.pubblicata });
    const e = await caught(svc.publish(TENANT, 'c1'));
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(errorCodeOf(e)).toBe('E_CIRCOLARE_NOT_BOZZA');
    expect(circolare.update).not.toHaveBeenCalled();
  });

  it('publish() su circolare inesistente/altro tenant → 404 (RLS → findFirst null)', async () => {
    circolare.findFirst.mockResolvedValue(null);
    const e = await caught(svc.publish(TENANT, 'c1'));
    expect(e).toBeInstanceOf(NotFoundException);
    expect(errorCodeOf(e)).toBe('E_CIRCOLARE_NOT_FOUND');
  });

  it('archive() su bozza → 422 E_CIRCOLARE_NOT_PUBBLICATA', async () => {
    circolare.findFirst.mockResolvedValue({ id: 'c1', stato: CircolareStato.bozza });
    const e = await caught(svc.archive(TENANT, 'c1'));
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(errorCodeOf(e)).toBe('E_CIRCOLARE_NOT_PUBBLICATA');
  });

  it('softDelete() su pubblicata → 422 E_CIRCOLARE_NOT_BOZZA', async () => {
    circolare.findFirst.mockResolvedValue({ id: 'c1', stato: CircolareStato.pubblicata });
    const e = await caught(svc.softDelete(TENANT, 'c1'));
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(errorCodeOf(e)).toBe('E_CIRCOLARE_NOT_BOZZA');
    expect(circolare.update).not.toHaveBeenCalled();
  });
});

describe('CircolariService — validazione destinatari (create)', () => {
  let svc: CircolariService;

  const base: Omit<CreateCircolareDto, 'destinatari'> = {
    titolo: 'T',
    oggettoEmail: 'O',
    bodyHtml: '<p>x</p>',
  };

  beforeEach(() => {
    svc = new CircolariService(makeDb().db);
  });

  it("tipo='azienda' senza aziendaId → 400 E_CIRCOLARE_DESTINATARIO_AZIENDA_REQUIRED", async () => {
    const dto: CreateCircolareDto = { ...base, destinatari: [{ tipo: 'azienda' as never }] };
    const e = await caught(svc.create(TENANT, dto));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(errorCodeOf(e)).toBe('E_CIRCOLARE_DESTINATARIO_AZIENDA_REQUIRED');
  });

  it("tipo='utente' → 400 E_CIRCOLARE_DESTINATARIO_UTENTE_UNSUPPORTED (defer livello 2)", async () => {
    const dto: CreateCircolareDto = { ...base, destinatari: [{ tipo: 'utente' as never }] };
    const e = await caught(svc.create(TENANT, dto));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(errorCodeOf(e)).toBe('E_CIRCOLARE_DESTINATARIO_UTENTE_UNSUPPORTED');
  });

  it("tipo='tutti' con aziendaId → 400 E_CIRCOLARE_DESTINATARIO_TUTTI_NO_AZIENDA", async () => {
    const dto: CreateCircolareDto = {
      ...base,
      destinatari: [{ tipo: 'tutti' as never, aziendaId: 'az-1' }],
    };
    const e = await caught(svc.create(TENANT, dto));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(errorCodeOf(e)).toBe('E_CIRCOLARE_DESTINATARIO_TUTTI_NO_AZIENDA');
  });
});
