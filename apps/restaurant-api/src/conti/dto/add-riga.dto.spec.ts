// =============================================================================
// add-riga.dto.spec.ts — unit validation AddRigaDto (KDS precursor, ADR-0069)
// =============================================================================
// Copre i constraint class-validator senza il harness E2E (razionale ADR-0019
// §TD-BS: in E2E la ValidationPipe non riceve design:paramtypes → il DTO @Body
// non viene validato). plainToInstance + validate() eseguono i decorator; i
// `message` sono gli E_*. Focus di questo spec: il campo `note` (nuovo).
// =============================================================================

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { AddRigaDto } from './add-riga.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(AddRigaDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const base = { articleId: 'art_1', quantita: 1 };

describe('AddRigaDto validation — note', () => {
  it('accepts payload senza note (opzionale)', async () => {
    expect(await messagesFor(base)).toHaveLength(0);
  });

  it('accepts note fino a 200 char', async () => {
    expect(await messagesFor({ ...base, note: 'a'.repeat(200) })).toHaveLength(0);
  });

  it('accepts note vuota (stringa "")', async () => {
    expect(await messagesFor({ ...base, note: '' })).toHaveLength(0);
  });

  it('rejects note oltre 200 char → E_CONTO_NOTE_TOO_LONG', async () => {
    expect(await messagesFor({ ...base, note: 'a'.repeat(201) })).toContain(
      'E_CONTO_NOTE_TOO_LONG',
    );
  });

  it('rejects note non-stringa → E_CONTO_NOTE_INVALID', async () => {
    expect(await messagesFor({ ...base, note: 123 })).toContain('E_CONTO_NOTE_INVALID');
  });
});

describe('AddRigaDto normalizzazione note (Delta A: trim + empty→null)', () => {
  it('test 1 — trimma il whitespace ai bordi', () => {
    const dto = plainToInstance(AddRigaDto, { ...base, note: '  senza glutine  ' });
    expect(dto.note).toBe('senza glutine');
  });

  it('test 2 — note assente resta undefined (create → null nel service)', () => {
    const dto = plainToInstance(AddRigaDto, base);
    expect(dto.note).toBeUndefined();
  });

  it('test 3 — note di soli spazi → null', () => {
    const dto = plainToInstance(AddRigaDto, { ...base, note: '   ' });
    expect(dto.note).toBeNull();
  });

  it('stringa vuota "" → null', () => {
    const dto = plainToInstance(AddRigaDto, { ...base, note: '' });
    expect(dto.note).toBeNull();
  });

  it('test 7 — MaxLength valuta il valore trimmato: 200 char + spazi ai bordi → valido', async () => {
    const note = `  ${'a'.repeat(200)}  `;
    expect(await messagesFor({ ...base, note })).toHaveLength(0);
  });
});
