// =============================================================================
// inviti-types.ts — tipi client inviti cliente (feat/invito-cliente)
// =============================================================================
// Wire: expiresAt/createdAt sono ISO string (Prisma DateTime → string sul JSON).
// =============================================================================

export type ClienteRuolo = 'admin' | 'utente';

export interface Invito {
  id: string;
  email: string;
  clienteRuolo: ClienteRuolo;
  expiresAt: string;
  createdAt: string;
  invitatoDa: { firstName: string; lastName: string };
}

export interface CreateInvitoInput {
  email: string;
  clienteRuolo?: ClienteRuolo;
}
