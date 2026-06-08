// =============================================================================
// create-azienda.dto.spec.ts — unit validation (TD-BS Sub-1)
// =============================================================================
// La ValidationPipe non si attiva nel harness E2E SWC: i constraint
// class-validator vanno coperti a livello unit. plainToInstance applica @Type,
// validate() esegue i decorator; i `message` sono gli errorCode E_AZIENDA_*.
// L'enum TipoCliente e' importato da @gestionale/db (re-export Prisma): se il
// barrel non lo esporta, @IsEnum si rompe qui (canary).
// =============================================================================

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateAziendaDto } from './create-azienda.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateAziendaDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const VALID = { codice: 'AZ001', nome: 'Rossi Srl', tipoCliente: 'azienda' };

describe('CreateAziendaDto validation', () => {
  it('accepts a valid minimal payload', async () => {
    expect(await messagesFor(VALID)).toHaveLength(0);
  });

  it('accepts a valid full payload', async () => {
    const msgs = await messagesFor({
      ...VALID,
      tipoCliente: 'persona_fisica',
      partitaIva: '01234567890',
      codiceFiscale: 'RSSMRA80A01H501U',
      codiceAteco: '62.01.00',
      email: 'info@rossi.it',
      emailOperativa: 'ops@rossi.it',
      pec: 'rossi@pec.it',
      sitoWeb: 'https://rossi.it',
      telefono: '+39061234567',
      telefono2: '+39069999999',
      indirizzo: 'Via Roma 1, Roma',
      noteOperative: 'Cliente storico',
      attivo: true,
    });
    expect(msgs).toHaveLength(0);
  });

  it('rejects missing codice → E_AZIENDA_CODICE_REQUIRED', async () => {
    const msgs = await messagesFor({ nome: 'Rossi Srl', tipoCliente: 'azienda' });
    expect(msgs).toContain('E_AZIENDA_CODICE_REQUIRED');
  });

  it('rejects empty codice → E_AZIENDA_CODICE_REQUIRED', async () => {
    expect(await messagesFor({ ...VALID, codice: '' })).toContain('E_AZIENDA_CODICE_REQUIRED');
  });

  it('rejects codice too long → E_AZIENDA_CODICE_TOO_LONG', async () => {
    expect(await messagesFor({ ...VALID, codice: 'x'.repeat(21) })).toContain(
      'E_AZIENDA_CODICE_TOO_LONG',
    );
  });

  it('rejects missing nome', async () => {
    const msgs = await messagesFor({ codice: 'AZ001', tipoCliente: 'azienda' });
    expect(msgs).toContain('E_AZIENDA_NOME_REQUIRED');
  });

  it('rejects nome too long → E_AZIENDA_NOME_TOO_LONG', async () => {
    expect(await messagesFor({ ...VALID, nome: 'x'.repeat(201) })).toContain(
      'E_AZIENDA_NOME_TOO_LONG',
    );
  });

  it('rejects missing tipoCliente → E_AZIENDA_TIPO_CLIENTE_INVALID', async () => {
    const msgs = await messagesFor({ codice: 'AZ001', nome: 'Rossi Srl' });
    expect(msgs).toContain('E_AZIENDA_TIPO_CLIENTE_INVALID');
  });

  it('rejects invalid tipoCliente enum → E_AZIENDA_TIPO_CLIENTE_INVALID', async () => {
    expect(await messagesFor({ ...VALID, tipoCliente: 'ditta' })).toContain(
      'E_AZIENDA_TIPO_CLIENTE_INVALID',
    );
  });

  it('rejects partitaIva too long → E_AZIENDA_PARTITA_IVA_TOO_LONG', async () => {
    expect(await messagesFor({ ...VALID, partitaIva: 'x'.repeat(21) })).toContain(
      'E_AZIENDA_PARTITA_IVA_TOO_LONG',
    );
  });

  it('rejects malformed email → E_AZIENDA_EMAIL_INVALID', async () => {
    expect(await messagesFor({ ...VALID, email: 'not-an-email' })).toContain(
      'E_AZIENDA_EMAIL_INVALID',
    );
  });

  it('rejects non-boolean attivo → E_AZIENDA_ATTIVO_INVALID', async () => {
    expect(await messagesFor({ ...VALID, attivo: 'yes' })).toContain('E_AZIENDA_ATTIVO_INVALID');
  });
});
