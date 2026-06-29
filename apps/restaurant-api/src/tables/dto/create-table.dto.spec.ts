// =============================================================================
// create-table.dto.spec.ts — unit validation (F2 Mappa sala, ADR-0058)
// =============================================================================
// Copre i constraint class-validator del DTO senza il harness E2E (stesso
// razionale di create-menu.dto.spec.ts, ADR-0019 §TD-BS). plainToInstance
// applica @Type, validate() esegue i decorator. I `message` sono gli errorCode E_*.
// =============================================================================

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateTableDto } from './create-table.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateTableDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateTableDto validation', () => {
  it('accepts a valid minimal payload', async () => {
    expect(await messagesFor({ numero: '12', capienza: 4 })).toHaveLength(0);
  });

  it('accepts a valid full payload with coordinates', async () => {
    const msgs = await messagesFor({ numero: 'Terrazza 3', capienza: 6, posX: 120.5, posY: 40 });
    expect(msgs).toHaveLength(0);
  });

  it('rejects empty numero → E_TABLE_NUMERO_REQUIRED', async () => {
    expect(await messagesFor({ numero: '', capienza: 4 })).toContain('E_TABLE_NUMERO_REQUIRED');
  });

  it('rejects numero too long → E_TABLE_NUMERO_TOO_LONG', async () => {
    const msgs = await messagesFor({ numero: 'x'.repeat(51), capienza: 4 });
    expect(msgs).toContain('E_TABLE_NUMERO_TOO_LONG');
  });

  it('rejects missing numero', async () => {
    expect((await messagesFor({ capienza: 4 })).length).toBeGreaterThan(0);
  });

  it('rejects capienza < 1 → E_TABLE_CAPIENZA_INVALID', async () => {
    expect(await messagesFor({ numero: '12', capienza: 0 })).toContain('E_TABLE_CAPIENZA_INVALID');
  });

  it('rejects non-integer capienza → E_TABLE_CAPIENZA_INVALID', async () => {
    const msgs = await messagesFor({ numero: '12', capienza: 2.5 });
    expect(msgs).toContain('E_TABLE_CAPIENZA_INVALID');
  });

  it('rejects missing capienza', async () => {
    expect((await messagesFor({ numero: '12' })).length).toBeGreaterThan(0);
  });

  it('rejects non-numeric posX → E_TABLE_POS_INVALID', async () => {
    const msgs = await messagesFor({ numero: '12', capienza: 4, posX: 'left' });
    expect(msgs).toContain('E_TABLE_POS_INVALID');
  });
});
