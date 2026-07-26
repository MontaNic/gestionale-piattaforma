// =============================================================================
// registra-pagamento.dto.spec.ts — unit validation POST /conti/:id/pagamenti
// =============================================================================
// Copre i constraint class-validator del DTO senza il harness E2E (razionale
// ADR-0019 §TD-BS Sub-2: in E2E la ValidationPipe non riceve design:paramtypes,
// verificato empiricamente in PR1 anche sui @Body — un `importo: 0` passa il
// harness e viene respinto solo in prod, dove `nest build --builder swc` emette
// decoratorMetadata). Qui plainToInstance + validate() eseguono i decorator;
// i `message` sono gli E_*.
//
// Il tetto REALE dell'importo è il residuo del conto (E_PAGAMENTO_EXCEEDS_RESIDUO,
// coperto in cassa.e2e-spec.ts): il DTO respinge solo l'input strutturalmente
// impossibile.
// =============================================================================

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { RegistraPagamentoDto } from './registra-pagamento.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(RegistraPagamentoDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('RegistraPagamentoDto validation', () => {
  it('accepts i 3 metodi dell enum (contanti/carta/altro)', async () => {
    expect(await messagesFor({ metodo: 'contanti', importo: 10 })).toHaveLength(0);
    expect(await messagesFor({ metodo: 'carta', importo: 10 })).toHaveLength(0);
    expect(await messagesFor({ metodo: 'altro', importo: 10 })).toHaveLength(0);
  });

  it('rejects metodo fuori enum → E_PAGAMENTO_METODO_INVALID', async () => {
    expect(await messagesFor({ metodo: 'bitcoin', importo: 10 })).toContain(
      'E_PAGAMENTO_METODO_INVALID',
    );
  });

  it('rejects metodo assente → E_PAGAMENTO_METODO_INVALID', async () => {
    expect(await messagesFor({ importo: 10 })).toContain('E_PAGAMENTO_METODO_INVALID');
  });

  it('accepts importo con 0, 1 o 2 decimali', async () => {
    expect(await messagesFor({ metodo: 'contanti', importo: 8 })).toHaveLength(0);
    expect(await messagesFor({ metodo: 'contanti', importo: 8.5 })).toHaveLength(0);
    expect(await messagesFor({ metodo: 'contanti', importo: 8.05 })).toHaveLength(0);
  });

  it('accepts il minimo 0.01 (un centesimo è un pagamento valido)', async () => {
    expect(await messagesFor({ metodo: 'contanti', importo: 0.01 })).toHaveLength(0);
  });

  it('rejects importo 0 → E_PAGAMENTO_IMPORTO_INVALID (un pagamento da 0 non è un pagamento)', async () => {
    expect(await messagesFor({ metodo: 'contanti', importo: 0 })).toContain(
      'E_PAGAMENTO_IMPORTO_INVALID',
    );
  });

  it('rejects importo negativo → E_PAGAMENTO_IMPORTO_INVALID (il rimborso è uno storno, non un pagamento)', async () => {
    expect(await messagesFor({ metodo: 'contanti', importo: -5 })).toContain(
      'E_PAGAMENTO_IMPORTO_INVALID',
    );
  });

  it('rejects 3 decimali → E_PAGAMENTO_IMPORTO_INVALID (Decimal(10,2) li troncherebbe silenziosamente)', async () => {
    expect(await messagesFor({ metodo: 'contanti', importo: 1.005 })).toContain(
      'E_PAGAMENTO_IMPORTO_INVALID',
    );
  });

  it('rejects importo oltre la capienza di Decimal(10,2) → E_PAGAMENTO_IMPORTO_INVALID', async () => {
    expect(await messagesFor({ metodo: 'contanti', importo: 100_000_000 })).toContain(
      'E_PAGAMENTO_IMPORTO_INVALID',
    );
  });

  it('rejects importo non numerico → E_PAGAMENTO_IMPORTO_INVALID', async () => {
    expect(await messagesFor({ metodo: 'contanti', importo: 'otto' })).toContain(
      'E_PAGAMENTO_IMPORTO_INVALID',
    );
  });

  it('rejects importo assente → E_PAGAMENTO_IMPORTO_INVALID', async () => {
    expect(await messagesFor({ metodo: 'contanti' })).toContain('E_PAGAMENTO_IMPORTO_INVALID');
  });
});
