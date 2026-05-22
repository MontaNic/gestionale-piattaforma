// =============================================================================
// prisma-errors.ts — conversione errori Prisma → eccezioni HTTP di dominio
// =============================================================================
// TD-CA (ADR-0024): il pre-check di unicità nome (`findFirst`) e il `create`/
// `update` non sono atomici → una race TOCTOU può far passare il pre-check e poi
// violare il partial unique index → `P2002`. Senza gestione `P2002` non è un
// `HttpException` → sfugge al `GlobalHttpExceptionFilter` (`@Catch(HttpException)`)
// → HTTP 500 invece di un 409 pulito.
//
// `catchUniqueViolation` wrappa il solo `create`/`update` e converte `P2002` in
// `ConflictException` con l'errorCode di dominio. Applicato **per-call-site**,
// non nel filter: ogni modello name-unique ha UN solo unique index → il `P2002`
// da quel call-site è inequivocabilmente il conflitto nome. Un catch generico
// mis-mapperebbe i constraint NON-name (ArticlePrice, user_roles, users.email,
// permissions.code, …) a "nome duplicato".
// =============================================================================

import { ConflictException } from '@nestjs/common';
import { Prisma } from '@gestionale/db';

/**
 * Esegue `fn`; se solleva una violazione di unique constraint Prisma (`P2002`)
 * la converte in `ConflictException({ errorCode })` — stessa shape del pre-check
 * applicativo, normalizzata da `GlobalHttpExceptionFilter`. Qualsiasi altro
 * errore (incluso `P2025` o altri code Prisma) è ri-lanciato invariato.
 */
export async function catchUniqueViolation<T>(fn: () => Promise<T>, errorCode: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException({ errorCode });
    }
    throw e;
  }
}
