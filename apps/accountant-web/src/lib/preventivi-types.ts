// =============================================================================
// preventivi-types.ts — Domain types preventivi (STOP-e2 ADR-0037)
// =============================================================================
// Shape allineata alle response { data } di accountant-api (preventivi
// controller, STOP-e1 ADR-0036), testata + voci nested sotto aziende. DateTime →
// stringa ISO; Decimal → number (Prisma serializza i Decimal come number nelle
// response JSON). Optional → null nelle response, omessi/undefined nei body di
// richiesta. I 3 totali sono RESPONSE-ONLY: il server li ricalcola dalle voci
// (mai inviati in request). Enum replicati come union string + const array per i
// `<select>`, senza dipendere da @gestionale/db (convenzione aziende/referenti).
// =============================================================================

export type StatoPreventivo = 'bozza' | 'inviato' | 'accettato' | 'rifiutato' | 'convertito';
// `convertito` (ADR-0051) NON è selezionabile a mano: lo imposta il backend alla
// creazione del mandato. Escluso da STATI_PREVENTIVO (select editing preventivo).
export const STATI_PREVENTIVO: readonly StatoPreventivo[] = [
  'bozza',
  'inviato',
  'accettato',
  'rifiutato',
];

export type UnitaMisura =
  | 'forfait'
  | 'ora'
  | 'mese'
  | 'anno'
  | 'documento'
  | 'dipendente'
  | 'pezzo';
export const UNITA_MISURA: readonly UnitaMisura[] = [
  'forfait',
  'ora',
  'mese',
  'anno',
  'documento',
  'dipendente',
  'pezzo',
];

export interface PreventivoVoce {
  id: string;
  tenantId: string;
  preventivoId: string;
  nome: string;
  descrizione: string | null;
  unitaMisura: UnitaMisura;
  quantita: number;
  prezzoUnitario: number;
  scontoPct: number;
  ivaAliquota: number;
  totaleRiga: number;
  ordine: number;
  note: string | null;
  servizioId: string | null;
}

export interface Preventivo {
  id: string;
  tenantId: string;
  aziendaId: string;
  codice: string;
  oggetto: string;
  coverLetter: string | null;
  noteInterne: string | null;
  stato: StatoPreventivo;
  validoFino: string | null; // ISO date (YYYY-MM-DD), @db.Date
  totaleImponibile: number;
  totaleIva: number;
  totale: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Preventivo con voci incluse — shape del detail (GET /:id). */
export interface PreventivoWithVoci extends Preventivo {
  voci: PreventivoVoce[];
}

/** Voce nel body di create/update. totaleRiga NON è input (server-calc). */
export interface VoceInput {
  nome: string;
  descrizione?: string;
  unitaMisura: UnitaMisura;
  quantita: number;
  prezzoUnitario: number;
  scontoPct: number;
  ivaAliquota: number;
  ordine?: number;
  note?: string;
  // Tracciabilità catalogo (ADR-0050): voce sorgente; non vincola il prezzo.
  servizioId?: string;
}

export interface CreatePreventivoInput {
  codice: string;
  oggetto: string;
  coverLetter?: string;
  noteInterne?: string;
  stato?: StatoPreventivo;
  validoFino?: string; // YYYY-MM-DD
  voci: VoceInput[];
}
export type UpdatePreventivoInput = Partial<CreatePreventivoInput>;

/** Payload prodotto da `PreventivoForm` (testata + voci convertite a number). */
export type PreventivoFormPayload = CreatePreventivoInput;
