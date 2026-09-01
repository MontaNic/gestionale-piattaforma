// =============================================================================
// rbac-catalog.ts — catalogo RBAC versionato: permessi + template di ruolo
// =============================================================================
// FONTE DI VERITÀ del set atteso, per il seed E per il gate di deriva.
//
// Perché è un modulo a sé e non vive dentro `seed.ts`: `seed.ts` ESEGUE il seed
// al top-level (`withSystemContext(() => main())` in fondo al file), quindi
// importarlo per leggerne il catalogo lo farebbe girare. Il gate
// `check-role-permissions-drift.ts` deve poter confrontare DB ↔ codice senza
// scrivere nulla → il catalogo sta qui, dato puro, zero side-effect, zero
// import di `../src/index` (nessun client Prisma istanziato).
//
// L'alternativa era hardcodare i totali (44 permessi / 154 mapping) nel gate:
// un presidio da aggiornare a mano ad ogni feature con permessi nuovi, cioè
// esattamente il fallimento che il gate esiste per chiudere.
//
// Contenuto invariato rispetto a `seed.ts` (move puro, ADR-0066 amendment):
//   PermissionSeed / PERMISSIONS / RoleTemplateSeed / ALL_PERMISSION_CODES /
//   ROLE_TEMPLATES.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// 1. Permission catalog (44 atomici, di cui 4 isPortale)
// ─────────────────────────────────────────────────────────────────────────────
// Categoria = primo segmento prima del primo punto.
// isPreF2 = true per feature [PRE F2] ancora non attive. Oggi NESSUN permesso
// lo porta: i tre che l'avevano (magazzino.* e ai.assistant.usa) erano del
// verticale food e sono usciti con esso. Il campo resta perché è la forma con
// cui si dichiara un permesso non ancora attivo, e la colonna DB esiste.
// ─────────────────────────────────────────────────────────────────────────────
export interface PermissionSeed {
  code: string;
  description: string;
  category: string;
  isPreF2?: boolean;
  // [livello 2 — portale cliente, ADR-0046 §6] permesso cliente-facing: escluso
  // dai template studio ("tutti i permessi"), assegnato solo al ruolo "Cliente".
  isPortale?: boolean;
}

export const PERMISSIONS: PermissionSeed[] = [
  // sistema.* (8)
  {
    code: 'sistema.tenant.gestisci',
    description: 'Configurazione tenant globale',
    category: 'sistema',
  },
  { code: 'sistema.utente.crea', description: 'Creazione nuovi utenti', category: 'sistema' },
  {
    code: 'sistema.utente.modifica',
    description: 'Modifica utenti esistenti',
    category: 'sistema',
  },
  { code: 'sistema.utente.disabilita', description: 'Disabilitazione utenti', category: 'sistema' },
  { code: 'sistema.ruolo.crea', description: 'Creazione ruoli custom', category: 'sistema' },
  {
    code: 'sistema.ruolo.assegna',
    description: 'Assegnazione ruoli a utenti',
    category: 'sistema',
  },
  {
    code: 'sistema.sede.gestisci',
    description: 'Gestione configurazione sedi',
    category: 'sistema',
  },
  {
    code: 'sistema.audit.visualizza',
    description: 'Visualizzazione audit log',
    category: 'sistema',
  },

  // anagrafica.* (6)
  {
    code: 'anagrafica.cliente.crea',
    description: 'Creazione anagrafica clienti',
    category: 'anagrafica',
  },
  {
    code: 'anagrafica.cliente.modifica',
    description: 'Modifica anagrafica clienti',
    category: 'anagrafica',
  },
  {
    code: 'anagrafica.cliente.visualizza',
    description: 'Visualizzazione clienti',
    category: 'anagrafica',
  },
  {
    code: 'anagrafica.cliente.elimina',
    description: 'Eliminazione anagrafica clienti',
    category: 'anagrafica',
  },
  {
    code: 'anagrafica.fornitore.gestisci',
    description: 'Gestione fornitori',
    category: 'anagrafica',
  },
  // Invito clienti al portale (onboarding utenti-portale). Non-portale
  // (isPortale assente → false): è un potere lato studio. Flowa in
  // ALL_PERMISSION_CODES → Super Admin + Admin sede + Socio (admin-tier).
  {
    code: 'clienti.invitare',
    description: 'Invito di clienti al portale (onboarding utenti-portale)',
    category: 'anagrafica',
  },

  // preventivi.* (2) — verticale accountant (STOP-e1)
  {
    code: 'preventivi.visualizza',
    description: 'Visualizzazione preventivi',
    category: 'preventivi',
  },
  {
    code: 'preventivi.gestisci',
    description: 'Crea/modifica/elimina preventivi',
    category: 'preventivi',
  },

  // scadenze.* (2) — verticale accountant (STOP-scad1)
  {
    code: 'scadenze.visualizza',
    description: 'Visualizzazione scadenze (calendario fiscale)',
    category: 'scadenze',
  },
  {
    code: 'scadenze.gestisci',
    description: 'Crea/modifica/elimina scadenze e categorie custom',
    category: 'scadenze',
  },

  // servizi.* (2) — catalogo servizi (ADR-0050, Onda 3 Task 1)
  {
    code: 'servizi.visualizza',
    description: 'Visualizzazione catalogo servizi',
    category: 'servizi',
  },
  {
    code: 'servizi.gestisci',
    description: 'Crea/modifica/elimina servizi e categorie catalogo custom',
    category: 'servizi',
  },

  // mandati.* (2) — mandati/incarichi (ADR-0051, Onda 3 Task 2)
  {
    code: 'mandati.visualizza',
    description: 'Visualizzazione mandati/incarichi',
    category: 'mandati',
  },
  {
    code: 'mandati.gestisci',
    description: 'Crea (da preventivo accettato) / modifica / elimina mandati',
    category: 'mandati',
  },

  // prestazioni.* (2) — timesheet su mandato (ADR-0053, Onda 3 Task 3)
  {
    code: 'prestazioni.visualizza',
    description: 'Visualizzazione prestazioni/timesheet dei mandati',
    category: 'prestazioni',
  },
  {
    code: 'prestazioni.gestisci',
    description: 'Registra/modifica/elimina prestazioni (ore) sui mandati in corso',
    category: 'prestazioni',
  },

  // tariffario.* (2) — listino tariffe orarie di COSTO (ADR-0055, Onda 4 Task 3b)
  {
    code: 'tariffario.visualizza',
    description: 'Visualizzazione listino tariffe orarie (costo per ruolo/utente)',
    category: 'tariffario',
  },
  {
    code: 'tariffario.gestisci',
    description: 'Crea/modifica/elimina tariffe orarie di costo (per ruolo/utente)',
    category: 'tariffario',
  },

  // comunicazioni.* (2) — verticale accountant (ADR-0043)
  {
    code: 'comunicazioni.visualizza',
    description: 'Visualizzazione comunicazioni (thread studio↔cliente)',
    category: 'comunicazioni',
  },
  {
    code: 'comunicazioni.gestisci',
    description: 'Apri/rispondi/assegna/chiudi comunicazioni e allegati',
    category: 'comunicazioni',
  },

  // documenti.* (2) — verticale accountant (ADR-0044)
  {
    code: 'documenti.visualizza',
    description: 'Visualizzazione/download documenti studio↔cliente',
    category: 'documenti',
  },
  {
    code: 'documenti.gestisci',
    description: 'Carica/elimina documenti e gestisci tipi custom',
    category: 'documenti',
  },

  // circolari.* (4) — verticale accountant, broadcast studio→clienti (ADR-0045)
  {
    code: 'circolari.create',
    description: 'Crea e modifica bozze circolari',
    category: 'circolari',
  },
  {
    code: 'circolari.publish',
    description: 'Pubblica circolari (bozza → pubblicata)',
    category: 'circolari',
  },
  {
    code: 'circolari.archive',
    description: 'Archivia circolari pubblicate',
    category: 'circolari',
  },
  {
    code: 'circolari.read_report',
    description: 'Visualizza report destinatari delle circolari',
    category: 'circolari',
  },

  // notespese.* (3) — Note Spese v1 (accountant, PR-1). Nessuno è isPortale →
  // rientra in ALL_PERMISSION_CODES → Super Admin li riceve automaticamente.
  {
    code: 'notespese.gestisci',
    description: 'Gestione delle proprie note spese (crea/modifica/elimina/invia)',
    category: 'notespese',
  },
  {
    code: 'notespese.leggi_tutte',
    description: 'Visualizzazione note spese di tutti gli utenti del tenant',
    category: 'notespese',
  },
  {
    code: 'notespese.approva',
    description: 'Approvazione/rifiuto note spese altrui',
    category: 'notespese',
  },

  // report.* (3)
  {
    code: 'report.fatturato.visualizza',
    description: 'Visualizzazione report fatturato/margini',
    category: 'report',
  },
  {
    code: 'report.operativo.visualizza',
    description: 'Visualizzazione report operativi',
    category: 'report',
  },
  { code: 'report.export', description: 'Export report in formati esterni', category: 'report' },

  // portale.* (1) — [livello 2 — portale cliente, ADR-0046 §6]
  // Cliente-facing: consumer reale nel task Documenti read-only. Seedato forward
  // (come circolari.read_report di ADR-0045): il permesso esiste, l'endpoint
  // arriva col task successivo.
  {
    code: 'portale.documenti.visualizza',
    description: 'Visualizzazione documenti della propria azienda (portale cliente)',
    category: 'portale',
    isPortale: true,
  },
  // portale.comunicazioni.* (2) — [livello 2 — portale cliente, ADR-0047]
  // Prima superficie portale bidirezionale: read + reply lato cliente. Due
  // permessi distinti (a differenza del singolo documenti.visualizza) perché qui
  // c'è una scrittura.
  {
    code: 'portale.comunicazioni.visualizza',
    description: 'Visualizzazione comunicazioni della propria azienda (portale cliente)',
    category: 'portale',
    isPortale: true,
  },
  {
    code: 'portale.comunicazioni.rispondi',
    description: 'Risposta alle comunicazioni della propria azienda (portale cliente)',
    category: 'portale',
    isPortale: true,
  },
  // portale.circolari.* (1) — [livello 2 — portale cliente, ADR-0048]
  // Lettore circolari lato cliente: read + markLetta on-open + conferma. Permesso
  // unico (conferma è comunque gated dal flag richiedeConferma della testata) →
  // attiva il consumer reale di circolari_letture + richiede_conferma (deferiti
  // dall'MVP ADR-0045 §6). read_report lato studio resta forward (task a sé).
  {
    code: 'portale.circolari.visualizza',
    description: 'Visualizzazione circolari della propria azienda (portale cliente)',
    category: 'portale',
    isPortale: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. System role templates (11 ruoli: mix ristorazione + commercialisti + condivisi).
//    NB: isDefault=true su TUTTI → il bootstrap API li clona tutti, cross-verticale
//    (un tenant restaurant riceve anche i ruoli studio e viceversa). Oggi la curatela
//    per-verticale vive solo qui nel seed imperativo. Vedi TD-bootstrap-verticale (ADR-0060).
// ─────────────────────────────────────────────────────────────────────────────
export interface RoleTemplateSeed {
  name: string;
  description: string;
  permissionCodes: string[];
}

// Helper: tutti i codici permission del catalog STUDIO (esclusi i portale.*,
// cliente-facing — ADR-0046 §6). I template studio "tutti i permessi" (Super
// Admin / Admin sede / Socio) NON devono ricevere permessi del portale cliente.
export const ALL_PERMISSION_CODES = PERMISSIONS.filter((p) => !p.isPortale).map((p) => p.code);

export const ROLE_TEMPLATES: RoleTemplateSeed[] = [
  {
    name: 'Super Admin',
    description: 'Accesso completo a tutte le funzioni della piattaforma.',
    // Tutti i permessi studio (non-portale).
    permissionCodes: ALL_PERMISSION_CODES,
  },
  {
    name: 'Admin sede',
    description: 'Configurazione sede + RBAC locale. No config tenant globale.',
    // Tutti tranne sistema.tenant.gestisci (riservato al Super Admin).
    permissionCodes: ALL_PERMISSION_CODES.filter((c) => c !== 'sistema.tenant.gestisci'),
  },

  // ── Verticale commercialisti / StudioDesk (4 ruoli) ──────────────────────
  // Template globali aggiunti accanto ai 6 della ristorazione. Il catalogo
  // anagrafica non ha (ancora) permessi `anagrafica.referente.*`: il satellite
  // referenti riusa `anagrafica.cliente.*` come la UI → nessun codice referente
  // qui (skip da spec, "se esistono altrimenti skip").
  {
    name: 'Socio',
    description: 'Socio di studio: accesso ampio. No config tenant globale.',
    // Tutti tranne sistema.tenant.gestisci (riservato al Super Admin).
    permissionCodes: ALL_PERMISSION_CODES.filter((c) => c !== 'sistema.tenant.gestisci'),
  },
  {
    name: 'Collaboratore',
    description:
      'Operativo: gestione clienti, preventivi e scadenze. Nessuna eliminazione, nessun sistema.',
    permissionCodes: [
      'anagrafica.cliente.visualizza',
      'anagrafica.cliente.crea',
      'anagrafica.cliente.modifica',
      'preventivi.visualizza',
      'preventivi.gestisci',
      'scadenze.visualizza',
      'scadenze.gestisci',
      'servizi.visualizza',
      'mandati.visualizza',
      'mandati.gestisci',
      'prestazioni.visualizza',
      'prestazioni.gestisci',
      'comunicazioni.visualizza',
      'comunicazioni.gestisci',
      'documenti.visualizza',
      'documenti.gestisci',
      // Circolari: il collaboratore crea/modifica bozze; publish/archive/report
      // restano a Socio/Direzione (ADR-0045 §3).
      'circolari.create',
      // Note Spese (PR-2): il collaboratore gestisce solo le proprie note.
      'notespese.gestisci',
    ],
  },
  {
    name: 'Segreteria',
    description:
      'Consultazione clienti, preventivi e scadenze + comunicazioni/documenti operativi.',
    permissionCodes: [
      'anagrafica.cliente.visualizza',
      'preventivi.visualizza',
      'scadenze.visualizza',
      // La segreteria smista/risponde le comunicazioni e carica documenti: gestione attiva.
      'comunicazioni.visualizza',
      'comunicazioni.gestisci',
      'documenti.visualizza',
      'documenti.gestisci',
    ],
  },
  {
    name: 'Praticante',
    description:
      'Visualizzazione clienti, preventivi, scadenze, comunicazioni e documenti + registrazione ore (timesheet).',
    permissionCodes: [
      'anagrafica.cliente.visualizza',
      'preventivi.visualizza',
      'scadenze.visualizza',
      'comunicazioni.visualizza',
      'documenti.visualizza',
      // Il praticante registra le proprie ore sui mandati (ADR-0053), pur non
      // gestendo lo stato dei mandati.
      'prestazioni.visualizza',
      'prestazioni.gestisci',
    ],
  },
  // [livello 2 — portale cliente, ADR-0046 §6] Ruolo degli utenti-portale
  // (tipo=cliente). Raccoglie i soli permessi portale.* — nessun permesso studio.
  // Task 1: solo lettura documenti della propria azienda (consumer reale nel
  // task Documenti). I poteri admin-azienda (cliente_ruolo='admin') arrivano coi
  // task successivi e non sono mappati su permessi globali.
  {
    name: 'Cliente',
    description: 'Utente del portale cliente: accesso ai dati della propria azienda.',
    permissionCodes: [
      'portale.documenti.visualizza',
      'portale.comunicazioni.visualizza',
      'portale.comunicazioni.rispondi',
      'portale.circolari.visualizza',
    ],
  },
];
