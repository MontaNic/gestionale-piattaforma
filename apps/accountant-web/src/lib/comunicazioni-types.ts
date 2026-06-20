// =============================================================================
// comunicazioni-types.ts — Domain types comunicazioni (verticale accountant, ADR-0043)
// =============================================================================
// Shape allineata alle response { data } di accountant-api (comunicazioni
// controller). Enum replicati come union + const array (convenzione scadenze/
// preventivi, no dipendenza da @gestionale/db). I campi data sono ISO datetime
// sul filo: i componenti li formattano con Intl, nessuna normalizzazione date-only
// necessaria (non sono @db.Date). Optional → null nelle response.
// =============================================================================

export type ComApertura = 'studio' | 'cliente';
export type ComLato = 'studio' | 'cliente' | 'interno';
export type ComOrigine = 'portale';

export interface Comunicazione {
  id: string;
  tenantId: string;
  codice: string;
  aziendaId: string;
  referenteId: string | null;
  apertaDa: ComApertura;
  operatoreAssegnatoId: string | null;
  oggetto: string;
  urgente: boolean;
  chiusa: boolean;
  chiusaIl: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComAllegato {
  id: string;
  messaggioId: string;
  nomeOrig: string;
  mimeType: string;
  dimensione: number;
  createdAt: string;
}

export interface ComMessaggio {
  id: string;
  comunicazioneId: string;
  autoreUserId: string | null;
  lato: ComLato;
  origine: ComOrigine;
  testo: string;
  lettoStudio: boolean;
  lettoCliente: boolean;
  createdAt: string;
  allegati: ComAllegato[];
}

/** Dettaglio thread: testata + messaggi (con allegati embedded). */
export interface ComunicazioneThread extends Comunicazione {
  messaggi: ComMessaggio[];
}

export interface CreateComunicazioneInput {
  aziendaId: string;
  referenteId?: string;
  oggetto: string;
  testo: string;
  urgente?: boolean;
  operatoreAssegnatoId?: string;
}

export interface CreateComMessaggioInput {
  testo: string;
  /** Lato operatore: 'studio' (visibile al cliente) o 'interno' (nota). */
  lato?: 'studio' | 'interno';
}

export interface UpdateComunicazioneInput {
  oggetto?: string;
  urgente?: boolean;
  chiusa?: boolean;
  /** null = rilascio assegnazione (torna "da prendere"). */
  operatoreAssegnatoId?: string | null;
}
