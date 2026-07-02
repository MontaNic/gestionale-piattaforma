// =============================================================================
// list-conti.query.dto.spec.ts — unit validation filtri GET /conti (PR-1 FE)
// =============================================================================
// Copre i constraint class-validator del DTO senza il harness E2E (razionale
// ADR-0019 §TD-BS: in E2E la ValidationPipe non riceve design:paramtypes).
// plainToInstance + validate() eseguono i decorator; i `message` sono gli E_*.
// =============================================================================

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ListContiQueryDto } from './list-conti.query.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(ListContiQueryDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('ListContiQueryDto validation', () => {
  it('accepts empty payload (nessun filtro → backward-compat)', async () => {
    expect(await messagesFor({})).toHaveLength(0);
  });

  it('accepts stato valido (aperto/chiuso/annullato)', async () => {
    expect(await messagesFor({ stato: 'aperto' })).toHaveLength(0);
    expect(await messagesFor({ stato: 'chiuso' })).toHaveLength(0);
    expect(await messagesFor({ stato: 'annullato' })).toHaveLength(0);
  });

  it('rejects stato non valido → E_CONTO_STATO_INVALID', async () => {
    expect(await messagesFor({ stato: 'inesistente' })).toContain('E_CONTO_STATO_INVALID');
  });

  it('accepts tavoloId non vuoto', async () => {
    expect(await messagesFor({ tavoloId: 'tvl_123' })).toHaveLength(0);
  });

  it('rejects tavoloId vuoto → E_CONTO_TAVOLO_INVALID', async () => {
    expect(await messagesFor({ tavoloId: '' })).toContain('E_CONTO_TAVOLO_INVALID');
  });

  it('accepts stato + tavoloId combinati', async () => {
    expect(await messagesFor({ stato: 'aperto', tavoloId: 'tvl_123' })).toHaveLength(0);
  });
});
