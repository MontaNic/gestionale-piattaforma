// =============================================================================
// report.service.spec.ts (ADR-0057) — guard insight < 2 mandati
// =============================================================================
// Verifica il path deterministico di margineInsight: con 0 o 1 mandato NON si
// chiama Groq (insight null, aiGenerated false); con ≥2 si delega a GroqService.
// La copertura è corretta in entrambi i path. DbService e GroqService mockati.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbService } from '@gestionale/db/nest';

import type { GroqService } from '../ai/groq.service';
import { ReportService } from './report.service';

/** Record mandato minimale come atteso dal `select` di margine(). */
function makeMandato(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    codice: 'M-1',
    stato: 'in_corso',
    importoConcordato: 1000,
    azienda: { id: 'a1', nome: 'Alfa Srl' },
    prestazioni: [{ ore: 2, importo: 300 }],
    ...over,
  };
}

function makeService(mandati: Array<Record<string, unknown>>) {
  const findMany = vi.fn().mockResolvedValue(mandati);
  const db = { prisma: { mandato: { findMany } } } as unknown as DbService;
  const analizzaMargine = vi.fn().mockResolvedValue('SINTESI AI');
  const groq = { analizzaMargine } as unknown as GroqService;
  return { svc: new ReportService(db, groq), analizzaMargine };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReportService.margineInsight — guard < 2 mandati', () => {
  it('0 mandati: deterministico (insight null, aiGenerated false), niente Groq', async () => {
    const { svc, analizzaMargine } = makeService([]);

    const res = await svc.margineInsight('t1');

    expect(res).toEqual({
      insight: null,
      aiGenerated: false,
      copertura: { totali: 0, conPrestazioni: 0 },
    });
    expect(analizzaMargine).not.toHaveBeenCalled();
  });

  it('1 mandato: deterministico, copertura corretta, niente Groq', async () => {
    const { svc, analizzaMargine } = makeService([makeMandato()]);

    const res = await svc.margineInsight('t1');

    expect(res.aiGenerated).toBe(false);
    expect(res.insight).toBeNull();
    expect(res.copertura).toEqual({ totali: 1, conPrestazioni: 1 });
    expect(analizzaMargine).not.toHaveBeenCalled();
  });

  it('2 mandati: chiama Groq una volta (aiGenerated true) e ritorna la sintesi', async () => {
    const { svc, analizzaMargine } = makeService([
      makeMandato({ id: 'm1', codice: 'M-1' }),
      // m2 senza prestazioni → importoPrestazioni null → copertura parziale
      makeMandato({ id: 'm2', codice: 'M-2', prestazioni: [] }),
    ]);

    const res = await svc.margineInsight('t1');

    expect(analizzaMargine).toHaveBeenCalledTimes(1);
    expect(res.aiGenerated).toBe(true);
    expect(res.insight).toBe('SINTESI AI');
    expect(res.copertura).toEqual({ totali: 2, conPrestazioni: 1 });
  });
});
