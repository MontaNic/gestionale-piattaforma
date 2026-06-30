/**
 * page-manifest.ts — accountant-web — single source of truth dello smoke tour.
 *
 * Principio (ADR smoke, STOP 1): l'insieme di pagine visitate da un ruolo =
 * le pagine a cui quel ruolo ha LEGITTIMAMENTE accesso. Per Super Admin = tutte
 * le pagine shell. Per ruoli operativi = solo le pagine per cui il ruolo possiede
 * il permesso di view (derivato da packages/db/prisma/seed.ts). Ogni pagina del
 * tour DEVE caricare senza 403/≥500 → un 403 lì è il bug che lo smoke cerca.
 *
 * Derivazione empirica (STOP 0 + STOP 1):
 *  - page.tsx: apps/accountant-web/src/app/t/[slug]/(authenticated)/**, /portale/**
 *  - gate view per-pagina: `permissions.includes('<perm>.visualizza')` nei componenti
 *  - NAV_ITEMS: apps/accountant-web/src/components/shell/Sidebar.tsx
 *  - permessi ruolo: seed.ts (Super Admin = ALL; Collaboratore/Cliente = elenco)
 *
 * Le rotte dinamiche ([id]) si risolvono a runtime navigando all'index e
 * seguendo il primo link di dettaglio (navigazione realistica, resta GET/read).
 * Lista vuota → skip con log (404 senza dati NON è il target).
 *
 * NOTA — incoerenze sidebar segnalate (NON silenziate): la sidebar accountant
 * filtra per permesso SOLO `tariffario`; tutte le altre voci (incl. report/margine)
 * sono sempre mostrate. Quindi a un Collaboratore la sidebar mostra `report/margine`
 * anche se manca `report.operativo.visualizza` (la pagina mostra un alert "permesso
 * mancante" — comportamento corretto ma incoerente). Per questo `report/margine`
 * NON è nel tour del Collaboratore. Vedi report STOP 1.
 */

export type Surface = 'operatore' | 'cliente';

export interface DynamicStrategy {
  /** Path index (dopo /t/<slug>/) da cui partire, es. 'clienti'. */
  indexPath: string;
  /**
   * Substring che identifica il link di dettaglio nell'index (es. '/clienti/').
   * Il tour segue il PRIMO anchor il cui href la contiene.
   */
  detailHrefIncludes?: string;
  /** Alternativa più precisa: regex (source) sull'href del link di dettaglio. */
  detailHrefPattern?: string;
  /**
   * Se presente, l'URL finale = href del dettaglio risolto + questo suffisso.
   * Permette di raggiungere una sotto-pagina di un dettaglio dinamico con UN
   * solo salto di risoluzione (es. clienti/<id> → clienti/<id>/preventivi/nuovo).
   */
  appendAfterDetail?: string;
}

export interface PageEntry {
  /** Path dopo /t/<slug>/ — per le dinamiche è il template (solo descrittivo). */
  path: string;
  /** Se presente, la rotta è dinamica e va risolta via index. */
  dynamic?: DynamicStrategy;
  note?: string;
}

export interface RoleManifest {
  /** Combacia col nome dello storageState in auth.setup.ts (.auth/<profile>.json). */
  profile: string;
  slug: string;
  surface: Surface;
  pages: readonly PageEntry[];
}

// Risoluzioni dinamiche riusabili.
const CLIENTE_DETAIL: DynamicStrategy = { indexPath: 'clienti', detailHrefIncludes: '/clienti/' };
const MANDATO_DETAIL: DynamicStrategy = { indexPath: 'mandati', detailHrefIncludes: '/mandati/' };
const CIRCOLARE_DETAIL: DynamicStrategy = {
  indexPath: 'circolari',
  detailHrefIncludes: '/circolari/',
};

export const ACCOUNTANT_MANIFEST: readonly RoleManifest[] = [
  // ---------------------------------------------------------------------------
  // Super Admin (ALL_PERMISSION_CODES) sul tenant studio-demo → tutte le pagine
  // shell del back-office. `platform/tenants` ESCLUSA: è tenant-gated (solo
  // `oneplatform`), non role-gated → fuori scope Fase 1 (vedi report STOP 1).
  // ---------------------------------------------------------------------------
  {
    profile: 'superadmin',
    slug: 'studio-demo',
    surface: 'operatore',
    pages: [
      { path: 'dashboard' },
      { path: 'clienti' },
      { path: 'scadenze' },
      { path: 'catalogo' },
      { path: 'tariffario' },
      { path: 'mandati' },
      { path: 'comunicazioni' },
      { path: 'documenti' },
      { path: 'circolari' },
      { path: 'fatture', note: 'PlaceholderPage' },
      { path: 'report/margine' },
      { path: 'clienti/[id]', dynamic: CLIENTE_DETAIL },
      { path: 'mandati/[id]', dynamic: MANDATO_DETAIL },
      { path: 'circolari/[id]', dynamic: CIRCOLARE_DETAIL },
      // ESCLUSA `comunicazioni/[id]`: il dettaglio comunicazione fa una
      // mark-as-read al mount (operatore: POST .../letto) → mutate-on-view, NON
      // read-only-safe e non-deterministico (parte solo se non-letta). Limite
      // noto dello smoke; pattern catturato come TD-comunicazioni-mutate-on-view
      // (ADR-0059). L'index `comunicazioni` resta nel tour.
      // Form di CREAZIONE preventivo: incluso (Nicolò STOP 1) perché al mount fa
      // fetch del voice-picker (#132) → è proprio una pagina che può dare 403 su
      // una fetch API (bug-class). Risoluzione a 1 salto: primo cliente dall'index
      // → /clienti/<id>/preventivi/nuovo. È un form: il guard read-only impedisce
      // qualsiasi submit; visitiamo solo (GET). Se l'attrito supera il valore
      // (es. primo cliente senza contesto valido), il tour deferisce CON log.
      {
        path: 'clienti/[id]/preventivi/nuovo',
        dynamic: {
          indexPath: 'clienti',
          detailHrefIncludes: '/clienti/',
          appendAfterDetail: '/preventivi/nuovo',
        },
      },
      // Deferito Fase 1: clienti/[id]/preventivi/[preventivoId] → dinamica a 2
      // salti (cliente → preventivo), fragile senza contesto dati garantito.
    ],
  },

  // ---------------------------------------------------------------------------
  // Collaboratore — solo pagine con permesso di view posseduto (seed.ts).
  // ESCLUSE: tariffario (no tariffario.visualizza — sidebar la nasconde,
  // coerente) e report/margine (no report.operativo.visualizza — sidebar la
  // mostra comunque: INCOERENZA segnalata, non nel tour).
  // INCLUSA circolari: il Collaboratore ha circolari.create (gestione bozze,
  // ADR-0045) → accesso legittimo; se l'index 403 è un finding reale (STOP 2).
  // ---------------------------------------------------------------------------
  {
    profile: 'collaboratore',
    slug: 'studio-demo',
    surface: 'operatore',
    pages: [
      { path: 'dashboard', note: 'anagrafica.cliente.visualizza' },
      { path: 'clienti', note: 'anagrafica.cliente.visualizza' },
      { path: 'scadenze', note: 'scadenze.visualizza' },
      { path: 'catalogo', note: 'servizi.visualizza' },
      { path: 'mandati', note: 'mandati.visualizza' },
      { path: 'comunicazioni', note: 'comunicazioni.visualizza' },
      { path: 'documenti', note: 'documenti.visualizza' },
      { path: 'circolari', note: 'circolari.create (watch: gate view index)' },
      { path: 'fatture', note: 'PlaceholderPage (no gate)' },
      { path: 'clienti/[id]', dynamic: CLIENTE_DETAIL },
      { path: 'mandati/[id]', dynamic: MANDATO_DETAIL },
      { path: 'circolari/[id]', dynamic: CIRCOLARE_DETAIL },
      // ESCLUSA `comunicazioni/[id]` — mutate-on-view (vedi nota in superadmin).
    ],
  },

  // ---------------------------------------------------------------------------
  // Cliente (tipo=cliente) — superficie PORTALE. Permessi: portale.* (seed.ts).
  // Post-login atterra su /t/studio-demo/portale (ADR-0046 §4).
  // ---------------------------------------------------------------------------
  {
    profile: 'cliente',
    slug: 'studio-demo',
    surface: 'cliente',
    pages: [
      { path: 'portale' },
      { path: 'portale/documenti', note: 'portale.documenti.visualizza' },
      { path: 'portale/comunicazioni', note: 'portale.comunicazioni.visualizza' },
      { path: 'portale/circolari', note: 'portale.circolari.visualizza' },
      // ESCLUSA `portale/comunicazioni/[id]`: mark-as-read al mount (cliente:
      // PATCH .../letto-cliente) → mutate-on-view, non read-only-safe. Vedi
      // TD-comunicazioni-mutate-on-view (ADR-0059). L'index resta nel tour.
      {
        path: 'portale/circolari/[id]',
        dynamic: { indexPath: 'portale/circolari', detailHrefIncludes: '/circolari/' },
      },
    ],
  },
] as const;
