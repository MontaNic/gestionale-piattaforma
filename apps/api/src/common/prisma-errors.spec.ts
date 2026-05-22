// =============================================================================
// prisma-errors.spec.ts — unit test di `catchUniqueViolation` (TD-CA, ADR-0024)
// =============================================================================
// La race TOCTOU reale (pre-check `findFirst` → `create` concorrente) non è
// riproducibile in modo deterministico in E2E. La copertura reale del fix è
// questo unit test: verifica che `P2002` → `ConflictException` con l'errorCode
// passato, e che ogni altro errore (incluso `P2025`) sia ri-lanciato invariato.
// =============================================================================

import { ConflictException } from '@nestjs/common';
import { Prisma } from '@gestionale/db';
import { describe, expect, it } from 'vitest';

import { catchUniqueViolation } from './prisma-errors';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`test ${code}`, {
    code,
    clientVersion: 'test',
  });
}

describe('catchUniqueViolation', () => {
  it("P2002 → ConflictException con l'errorCode di dominio passato", async () => {
    let caught: unknown;
    try {
      await catchUniqueViolation(() => Promise.reject(prismaError('P2002')), 'E_MENU_NAME_EXISTS');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toEqual({
      errorCode: 'E_MENU_NAME_EXISTS',
    });
  });

  it('errore generico → ri-lanciato invariato (non convertito)', async () => {
    const err = new Error('boom');
    await expect(
      catchUniqueViolation(() => Promise.reject(err), 'E_PRICE_LIST_NAME_EXISTS'),
    ).rejects.toBe(err);
  });

  it('P2025 (altro code Prisma) → ri-lanciato invariato, NON convertito in 409', async () => {
    const err = prismaError('P2025');
    await expect(
      catchUniqueViolation(() => Promise.reject(err), 'E_ARTICLE_NAME_EXISTS'),
    ).rejects.toBe(err);
  });

  it('happy path → ritorna il valore risolto da fn', async () => {
    const result = await catchUniqueViolation(
      () => Promise.resolve({ id: 'abc' }),
      'E_MENU_NAME_EXISTS',
    );
    expect(result).toEqual({ id: 'abc' });
  });
});
