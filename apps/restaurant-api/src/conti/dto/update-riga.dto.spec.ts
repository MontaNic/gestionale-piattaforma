// =============================================================================
// update-riga.dto.spec.ts — unit validation UpdateRigaDto (KDS precursor, ADR-0069)
// =============================================================================
// Copre i constraint class-validator senza il harness E2E (razionale ADR-0019
// §TD-BS). Focus: `note` opzionale + quantità obbligatoria invariata.
// =============================================================================

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { UpdateRigaDto } from './update-riga.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateRigaDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('UpdateRigaDto validation — note', () => {
  it('accepts quantita senza note (note invariata)', async () => {
    expect(await messagesFor({ quantita: 2 })).toHaveLength(0);
  });

  it('accepts quantita + note fino a 200 char', async () => {
    expect(await messagesFor({ quantita: 2, note: 'a'.repeat(200) })).toHaveLength(0);
  });

  it('rejects note oltre 200 char → E_CONTO_NOTE_TOO_LONG', async () => {
    expect(await messagesFor({ quantita: 2, note: 'a'.repeat(201) })).toContain(
      'E_CONTO_NOTE_TOO_LONG',
    );
  });

  it('rejects quantita mancante → E_CONTO_QUANTITA_INVALID (invariato)', async () => {
    expect(await messagesFor({ note: 'ok' })).toContain('E_CONTO_QUANTITA_INVALID');
  });
});
