// =============================================================================
// documenti-types.ts — Domain types documenti (verticale accountant, ADR-0044)
// =============================================================================
// Shape allineata alle response { data } di accountant-api (documenti controller).
// Enum replicati come union (no dipendenza da @gestionale/db). Visibilità MVP:
// solo tutti|azienda (utente nel backlog).
// =============================================================================

export type DirezioneDocumento = 'studio_cliente' | 'cliente_studio' | 'bidirezionale';
export type VisibilitaDocumento = 'tutti' | 'azienda';
export const VISIBILITA_DOCUMENTO: readonly VisibilitaDocumento[] = ['tutti', 'azienda'];

export interface DocumentoTipo {
  id: string;
  tenantId: string | null; // null = platform immutabile
  nome: string;
  direzione: DirezioneDocumento;
  visibilitaDefault: VisibilitaDocumento;
  ordine: number;
  attivo: boolean;
}

export interface Documento {
  id: string;
  tenantId: string;
  tipoId: string;
  aziendaId: string;
  nomeOriginale: string;
  storageKey: string;
  mimeType: string;
  dimensione: number;
  visibilita: VisibilitaDocumento;
  note: string | null;
  createdBy: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadDocumentoInput {
  tipoId: string;
  aziendaId: string;
  visibilita: VisibilitaDocumento;
  note?: string;
}

export interface CreateDocumentoTipoInput {
  nome: string;
  direzione: DirezioneDocumento;
  visibilitaDefault?: VisibilitaDocumento;
}
