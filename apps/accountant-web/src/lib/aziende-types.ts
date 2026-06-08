// =============================================================================
// aziende-types.ts — Domain types anagrafica clienti (STOP-c2 ADR-0032)
// =============================================================================
// Shape allineata alle response { data } di accountant-api (aziende controller,
// STOP-c1 ADR-0031). DateTime → stringa ISO. Optional → null nelle response,
// omessi/undefined nei body di richiesta.
// =============================================================================

export type TipoCliente = 'azienda' | 'persona_fisica';
export const TIPI_CLIENTE: readonly TipoCliente[] = ['azienda', 'persona_fisica'];

export interface Azienda {
  id: string;
  tenantId: string;
  codice: string;
  nome: string;
  tipoCliente: TipoCliente;
  partitaIva: string | null;
  codiceFiscale: string | null;
  codiceAteco: string | null;
  email: string | null;
  emailOperativa: string | null;
  pec: string | null;
  sitoWeb: string | null;
  telefono: string | null;
  telefono2: string | null;
  indirizzo: string | null;
  noteOperative: string | null;
  attivo: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateAziendaInput {
  codice: string;
  nome: string;
  tipoCliente: TipoCliente;
  partitaIva?: string;
  codiceFiscale?: string;
  codiceAteco?: string;
  email?: string;
  emailOperativa?: string;
  pec?: string;
  sitoWeb?: string;
  telefono?: string;
  telefono2?: string;
  indirizzo?: string;
  noteOperative?: string;
  attivo?: boolean;
}
export type UpdateAziendaInput = Partial<CreateAziendaInput>;

/** Payload prodotto da `AziendaForm` (tutti i 15 campi MVP). */
export type AziendaFormPayload = CreateAziendaInput;
