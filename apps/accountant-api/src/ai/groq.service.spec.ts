// =============================================================================
// groq.service.spec.ts (ADR-0056) — feature-flag + prompt + mappatura errori
// =============================================================================
// Mocka il modulo 'groq-sdk' (nessuna chiamata HTTP reale). Copre: feature-flag
// su GROQ_API_KEY, costruzione richiesta (modello/temperature/max_tokens), e la
// mappatura degli errori upstream/vuoti su 503 con errorCode stabile.
// =============================================================================

import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroqService, type ThreadPerBozza } from './groq.service';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => ({
  default: vi.fn(() => ({ chat: { completions: { create: mockCreate } } })),
}));

/** ConfigService fittizio: ritorna i valori passati per le sole chiavi note. */
function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function errorCodeOf(e: unknown): string | undefined {
  const res = (e as { getResponse?: () => unknown }).getResponse?.();
  return (res as { errorCode?: string } | undefined)?.errorCode;
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

const THREAD: ThreadPerBozza = {
  oggetto: 'Fattura mancante',
  messaggi: [{ lato: 'cliente', testo: 'Non trovo la fattura di marzo.' }],
};

beforeEach(() => {
  mockCreate.mockReset();
});

describe('GroqService — feature-flag', () => {
  it('isAvailable() = false quando GROQ_API_KEY è assente', () => {
    const svc = new GroqService(makeConfig({}));
    expect(svc.isAvailable()).toBe(false);
  });

  it('isAvailable() = false quando GROQ_API_KEY è una stringa vuota/whitespace', () => {
    const svc = new GroqService(makeConfig({ GROQ_API_KEY: '   ' }));
    expect(svc.isAvailable()).toBe(false);
  });

  it('isAvailable() = true quando GROQ_API_KEY è valorizzata', () => {
    const svc = new GroqService(makeConfig({ GROQ_API_KEY: 'gsk_test' }));
    expect(svc.isAvailable()).toBe(true);
  });

  it('suggerisciRisposta() lancia 503 E_AI_DISABLED senza key', async () => {
    const svc = new GroqService(makeConfig({}));
    const err = await caught(svc.suggerisciRisposta(THREAD));
    expect(errorCodeOf(err)).toBe('E_AI_DISABLED');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('GroqService — generazione', () => {
  it('ritorna la bozza trimmata e usa modello/temperatura/max_tokens attesi', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '  Buongiorno, allego la fattura.  ' } }],
    });
    const svc = new GroqService(makeConfig({ GROQ_API_KEY: 'gsk_test' }));

    const bozza = await svc.suggerisciRisposta(THREAD);

    expect(bozza).toBe('Buongiorno, allego la fattura.');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const arg = (mockCreate.mock.calls[0]?.[0] ?? {}) as {
      model: string;
      temperature: number;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(arg.model).toBe('llama-3.3-70b-versatile');
    expect(arg.temperature).toBe(0.4);
    expect(arg.max_tokens).toBe(400);
    expect(arg.messages[0]?.role).toBe('system');
    expect(arg.messages[1]?.content).toContain('Fattura mancante');
    expect(arg.messages[1]?.content).toContain('[Cliente] Non trovo la fattura di marzo.');
  });

  it('rispetta GROQ_MODEL override', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
    const svc = new GroqService(
      makeConfig({ GROQ_API_KEY: 'gsk_test', GROQ_MODEL: 'mixtral-8x7b' }),
    );
    await svc.suggerisciRisposta(THREAD);
    expect(((mockCreate.mock.calls[0]?.[0] ?? {}) as { model: string }).model).toBe('mixtral-8x7b');
  });

  it('mappa risposta vuota su 503 E_AI_EMPTY', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });
    const svc = new GroqService(makeConfig({ GROQ_API_KEY: 'gsk_test' }));
    const err = await caught(svc.suggerisciRisposta(THREAD));
    expect(errorCodeOf(err)).toBe('E_AI_EMPTY');
  });

  it('mappa errore SDK su 503 E_AI_UPSTREAM', async () => {
    mockCreate.mockRejectedValue(new Error('model_not_found'));
    const svc = new GroqService(makeConfig({ GROQ_API_KEY: 'gsk_test' }));
    const err = await caught(svc.suggerisciRisposta(THREAD));
    expect(errorCodeOf(err)).toBe('E_AI_UPSTREAM');
  });
});
