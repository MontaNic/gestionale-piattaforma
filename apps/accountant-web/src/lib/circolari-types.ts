// =============================================================================
// circolari-types.ts — Domain types circolari (verticale accountant, ADR-0045)
// =============================================================================
// Shape allineata alle response { data } di accountant-api (circolari controller).
// Enum replicati come union (convenzione scadenze/comunicazioni, no dipendenza da
// @gestionale/db). I campi data sono ISO datetime sul filo (formattati con Intl).
// `destinatari` presente solo su create/get/update (non sulla list).
// =============================================================================

export type CircolareStato = 'bozza' | 'pubblicata' | 'archiviata';
export type DestinatarioTipo = 'tutti' | 'azienda' | 'utente';

export interface CircolareDestinatario {
  id: string;
  circolareId: string;
  tipo: DestinatarioTipo;
  aziendaId: string | null;
}

export interface Circolare {
  id: string;
  tenantId: string;
  titolo: string;
  oggettoEmail: string;
  bodyHtml: string;
  stato: CircolareStato;
  priorita: number;
  richiedeConferma: boolean;
  pubblicataIl: string | null;
  scadeIl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Dettaglio: testata + destinatari (ritornato da get/create/update). */
export interface CircolareWithDestinatari extends Circolare {
  destinatari: CircolareDestinatario[];
}

export interface CreateDestinatarioInput {
  tipo: DestinatarioTipo;
  aziendaId?: string;
}

export interface CreateCircolareInput {
  titolo: string;
  oggettoEmail: string;
  bodyHtml: string;
  priorita?: number;
  scadeIl?: string;
  richiedeConferma?: boolean;
  destinatari: CreateDestinatarioInput[];
}

// ── Report letture lato studio (ADR-0048 §1) ────────────────────────────────
// Date ISO sul filo (lettaAt/confermataAt formattati con Intl lato componente).
export interface CircolareReportRecipient {
  userId: string;
  nome: string;
  email: string;
  aziendaId: string | null;
  letta: boolean;
  lettaAt: string | null;
  confermata: boolean;
  confermataAt: string | null;
}

export interface CircolareReportView {
  circolareId: string;
  stato: CircolareStato;
  richiedeConferma: boolean;
  summary: {
    attesi: number;
    letti: number;
    confermati: number;
  };
  recipients: CircolareReportRecipient[];
}

export interface UpdateCircolareInput {
  titolo?: string;
  oggettoEmail?: string;
  bodyHtml?: string;
  priorita?: number;
  scadeIl?: string;
  richiedeConferma?: boolean;
  destinatari?: CreateDestinatarioInput[];
}
