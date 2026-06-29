// =============================================================================
// comunicazioni-suggerisci.service.spec.ts (ADR-0056) — bozza AI: filtro + delega
// =============================================================================
// Verifica che suggerisciRisposta() escluda le note interne (lato='interno')
// prima di passare il thread a GroqService (mockato), e che propaghi la bozza.
// Il resto del CRUD è coperto altrove (e2e). DbService/StorageService mockati.
// =============================================================================

import type { DbService } from '@gestionale/db/nest';
import type { StorageService } from '@gestionale/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComunicazioniService } from './comunicazioni.service';
import type { GroqService } from '../ai/groq.service';

function makeService() {
  const comunicazione = { findFirst: vi.fn() };
  const db = { prisma: { comunicazione } } as unknown as DbService;
  const storage = {} as unknown as StorageService;
  const groq = { suggerisciRisposta: vi.fn() } as unknown as GroqService & {
    suggerisciRisposta: ReturnType<typeof vi.fn>;
  };
  const service = new ComunicazioniService(db, storage, groq);
  return { service, comunicazione, groq };
}

describe('ComunicazioniService.suggerisciRisposta', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('esclude le note interne e delega a GroqService, propagando la bozza', async () => {
    ctx.comunicazione.findFirst.mockResolvedValue({
      id: 'com-1',
      tenantId: 't1',
      oggetto: 'F24 in scadenza',
      messaggi: [
        { lato: 'cliente', testo: 'Quando scade?', allegati: [] },
        { lato: 'interno', testo: 'Cliente ritardatario, sollecitare', allegati: [] },
        { lato: 'studio', testo: 'Le confermo a breve', allegati: [] },
      ],
    });
    ctx.groq.suggerisciRisposta = vi.fn().mockResolvedValue('Scade il 16.');

    const out = await ctx.service.suggerisciRisposta('t1', 'com-1');

    expect(out).toEqual({ bozza: 'Scade il 16.' });
    const passed = (ctx.groq.suggerisciRisposta.mock.calls[0]?.[0] ?? {}) as {
      oggetto: string;
      messaggi: Array<{ lato: string; testo: string }>;
    };
    expect(passed.oggetto).toBe('F24 in scadenza');
    expect(passed.messaggi).toEqual([
      { lato: 'cliente', testo: 'Quando scade?' },
      { lato: 'studio', testo: 'Le confermo a breve' },
    ]);
  });

  it('propaga 404 se il thread non esiste (getById)', async () => {
    ctx.comunicazione.findFirst.mockResolvedValue(null);
    await expect(ctx.service.suggerisciRisposta('t1', 'missing')).rejects.toMatchObject({
      response: { errorCode: 'E_COM_NOT_FOUND' },
    });
    expect(
      (ctx.groq as { suggerisciRisposta: ReturnType<typeof vi.fn> }).suggerisciRisposta,
    ).not.toHaveBeenCalled();
  });
});
