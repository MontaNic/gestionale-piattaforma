// =============================================================================
// referenti-test-fixtures.ts — E2E helper satellite referenti (STOP-c3a)
// =============================================================================
// Mirror di aziende-test-fixtures.ts. I referenti riusano il catalogo permessi
// anagrafica.cliente.* (un referente è attributo del cliente) → si re-exportano
// le fixture di permission/login già esistenti invece di duplicarle. L'unica
// aggiunta è `createAziendaViaApi`: i referenti sono nested sotto un'azienda
// parent, che va creata via API (admin ha anagrafica.cliente.crea) prima dei
// test su /aziende/:aziendaId/referenti.
// =============================================================================

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export {
  ANAGRAFICA_CLIENTE_PERMISSION_CODES,
  seedAziendePermissions,
  seedViewer,
  loginAs,
  flushTenantSlugCache,
} from './aziende-test-fixtures';

/**
 * Crea un'azienda parent via API (POST /aziende) e ritorna il suo id. Richiede
 * un JWT con `anagrafica.cliente.crea`. Default body minimale valido.
 */
export async function createAziendaViaApi(
  app: INestApplication,
  jwt: string,
  body: Record<string, unknown> = { codice: 'AZ001', nome: 'Rossi Srl', tipoCliente: 'azienda' },
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/aziende')
    .set('Authorization', `Bearer ${jwt}`)
    .send(body)
    .expect(201);
  return res.body.data.id as string;
}
