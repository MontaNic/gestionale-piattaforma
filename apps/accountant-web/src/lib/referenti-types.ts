// =============================================================================
// referenti-types.ts — Domain types referenti (STOP-c3b ADR-0034)
// =============================================================================
// Shape allineata alle response { data } di accountant-api (referenti controller,
// STOP-c3a ADR-0033), satellite 1:N nested sotto aziende. DateTime → stringa
// ISO. Optional → null nelle response, omessi/undefined nei body di richiesta.
// =============================================================================

export type RuoloReferente = 'legale_rappresentante' | 'amministrativo' | 'tecnico' | 'altro';
export const RUOLI_REFERENTE: readonly RuoloReferente[] = [
  'legale_rappresentante',
  'amministrativo',
  'tecnico',
  'altro',
];

export interface Referente {
  id: string;
  tenantId: string;
  aziendaId: string;
  nome: string;
  ruolo: RuoloReferente;
  email: string | null;
  telefono: string | null;
  note: string | null;
  attivo: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateReferenteInput {
  nome: string;
  ruolo: RuoloReferente;
  email?: string;
  telefono?: string;
  note?: string;
  attivo?: boolean;
}
export type UpdateReferenteInput = Partial<CreateReferenteInput>;

/** Payload prodotto da `ReferenteForm` (tutti i 6 campi MVP). */
export type ReferenteFormPayload = CreateReferenteInput;
