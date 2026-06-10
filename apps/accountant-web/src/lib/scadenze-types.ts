// =============================================================================
// scadenze-types.ts — Domain types scadenze / calendario fiscale (STOP-scad2)
// =============================================================================
// Shape allineata alle response { data } di accountant-api (scadenze controller,
// STOP-scad1 ADR-0039). `dataScadenza` è @db.Date: il backend la serializza come
// ISO datetime completo → il layer api (scadenze-api) la normalizza a date-only
// YYYY-MM-DD, qui il domain type è già onesto (string YYYY-MM-DD). Optional →
// null nelle response, omessi/undefined nei body. Enum replicato come union
// string + const array per i `<select>` (convenzione aziende/preventivi, no
// dipendenza da @gestionale/db).
//
// NB: la lista scadenze NON include relazioni embedded (categoria/azienda): il
// nome azienda e il colore categoria si risolvono client-side con i lookup di
// `getScadenzeCategorie()` + `listAziende()`.
// =============================================================================

export type VisibilitaScadenza = 'tutti' | 'azienda' | 'utente';
export const VISIBILITA_SCADENZA: readonly VisibilitaScadenza[] = ['tutti', 'azienda', 'utente'];

export interface ScadenzaCategoria {
  id: string;
  /** null = categoria di piattaforma (immutabile); valorizzato = custom del tenant. */
  tenantId: string | null;
  nome: string;
  colore: string; // #RRGGBB
  ordine: number;
  attivo: boolean;
}

export interface Scadenza {
  id: string;
  tenantId: string;
  titolo: string;
  descrizione: string | null;
  dataScadenza: string; // YYYY-MM-DD (normalizzata da @db.Date nel layer api)
  categoriaId: string | null;
  visibilita: VisibilitaScadenza;
  aziendaId: string | null;
  attivo: boolean;
  codiceImport: string | null; // predisposto import esterni (inerte, YAGNI)
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScadenzaInput {
  titolo: string;
  descrizione?: string;
  dataScadenza: string; // YYYY-MM-DD
  categoriaId?: string;
  visibilita?: VisibilitaScadenza;
  aziendaId?: string;
  attivo?: boolean;
}
export type UpdateScadenzaInput = Partial<CreateScadenzaInput>;

/** Payload prodotto da `ScadenzaForm`. */
export type ScadenzaFormPayload = CreateScadenzaInput;

/** Body create categoria custom (solo nome + colore opzionale via UI). */
export interface CreateScadenzaCategoriaInput {
  nome: string;
  colore?: string;
}
