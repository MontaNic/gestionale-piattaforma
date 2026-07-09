// =============================================================================
// inviti-api.ts — data access client inviti cliente (feat/invito-cliente)
// =============================================================================
// Nested sotto aziende: /aziende/:aziendaId/inviti. NO react-query (confine del
// verticale, coerente con referenti-api). Token via getAccessToken().
// =============================================================================

import { apiDelete, apiGet, apiPost } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

import type { CreateInvitoInput, Invito } from './inviti-types';

interface Wrapped<T> {
  data: T;
}

export async function listInviti(aziendaId: string): Promise<Invito[]> {
  const res = await apiGet<Wrapped<Invito[]>>(`/aziende/${aziendaId}/inviti`, authOptions());
  return res.data;
}

export async function createInvito(aziendaId: string, input: CreateInvitoInput): Promise<Invito> {
  const res = await apiPost<Wrapped<Invito>>(`/aziende/${aziendaId}/inviti`, input, authOptions());
  return res.data;
}

/** DELETE backend risponde 200 `{ data: { id, revoked: true } }`, non 204. */
export async function revokeInvito(aziendaId: string, invitoId: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; revoked: true }>>(
    `/aziende/${aziendaId}/inviti/${invitoId}`,
    authOptions(),
  );
}
