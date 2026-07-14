// =============================================================================
// seed.ts — Seed idempotente per il data layer Gestionale
// =============================================================================
// Popola due cataloghi globali (no tenant_id):
//
//   1. permissions          (60 permessi atomici namespaced)
//   2. system_role_templates (11 template predefiniti, isDefault: true)
//      + system_role_template_permissions (mapping role -> permissions)
//   3. scadenze_categorie    (7 categorie piattaforma, tenant_id NULL)
//
// Pattern bootstrap nuovi tenant (vedi ADR-0005): quando nasce un tenant,
// l'app NestJS clonera' i system_role_templates con isDefault=true nei
// suoi `roles` tenant-scoped (con tenant_id valorizzato) e copiera i
// mapping da system_role_template_permissions a role_permissions.
//
// Idempotente: tutti gli upsert su unique key (code per permissions,
// name per templates, PK composta per mappings). Re-esecuzione safe.
//
// Run:
//   pnpm --filter @gestionale/db db:seed
//   (oppure: pnpm --filter @gestionale/db exec prisma db seed)
// =============================================================================

import argon2 from 'argon2';

import {
  ClienteRuolo,
  id,
  prisma,
  RuoloReferente,
  StatoPreventivo,
  TipoCliente,
  TipoRicorrenza,
  UnitaMisura,
  UserTipo,
  withSystemContext,
} from '../src/index';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Permission catalog (35 atomici)
// ─────────────────────────────────────────────────────────────────────────────
// Categoria = primo segmento prima del primo punto.
// isPreF2 = true per feature [PRE F2] ancora non attive (magazzino.*, ai.*).
// ─────────────────────────────────────────────────────────────────────────────
interface PermissionSeed {
  code: string;
  description: string;
  category: string;
  isPreF2?: boolean;
  // [livello 2 — portale cliente, ADR-0046 §6] permesso cliente-facing: escluso
  // dai template studio ("tutti i permessi"), assegnato solo al ruolo "Cliente".
  isPortale?: boolean;
}

const PERMISSIONS: PermissionSeed[] = [
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

  // menu.* (5)
  { code: 'menu.categoria.gestisci', description: 'Gestione categorie menu', category: 'menu' },
  { code: 'menu.piatto.crea', description: 'Creazione piatti/articoli', category: 'menu' },
  { code: 'menu.piatto.modifica', description: 'Modifica piatti/articoli', category: 'menu' },
  { code: 'menu.prezzo.modifica', description: 'Modifica prezzi e listini', category: 'menu' },
  { code: 'menu.visualizza', description: 'Visualizzazione menu', category: 'menu' },

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

  // comande.* (5)
  { code: 'comande.crea', description: 'Creazione comande', category: 'comande' },
  {
    code: 'comande.modifica',
    description: 'Modifica comande non ancora inviate',
    category: 'comande',
  },
  { code: 'comande.elimina', description: 'Eliminazione/storno comande', category: 'comande' },
  { code: 'comande.visualizza', description: 'Visualizzazione comande', category: 'comande' },
  { code: 'comande.stato.cambia', description: 'Cambio stato (cucina/bar)', category: 'comande' },

  // cassa.* (4)
  { code: 'cassa.scontrino.emetti', description: 'Emissione scontrino fiscale', category: 'cassa' },
  { code: 'cassa.storno.esegui', description: 'Esecuzione storni cassa', category: 'cassa' },
  {
    code: 'cassa.chiusura.giornaliera',
    description: 'Chiusura cassa giornaliera',
    category: 'cassa',
  },
  { code: 'cassa.visualizza', description: 'Visualizzazione movimenti cassa', category: 'cassa' },

  // tavoli.* (2) — F2 Mappa sala (ADR-0058)
  { code: 'tavoli.visualizza', description: 'Visualizzazione mappa tavoli', category: 'tavoli' },
  { code: 'tavoli.gestisci', description: 'Gestione tavoli e mappa sala', category: 'tavoli' },

  // magazzino.* (2) — [PRE F2]
  {
    code: 'magazzino.articolo.gestisci',
    description: 'Gestione articoli magazzino',
    category: 'magazzino',
    isPreF2: true,
  },
  {
    code: 'magazzino.movimento.crea',
    description: 'Creazione movimenti magazzino',
    category: 'magazzino',
    isPreF2: true,
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

  // ai.* (1) — [PRE F2]
  { code: 'ai.assistant.usa', description: 'Uso AI Assistant', category: 'ai', isPreF2: true },

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
interface RoleTemplateSeed {
  name: string;
  description: string;
  permissionCodes: string[];
}

// Helper: tutti i codici permission del catalog STUDIO (esclusi i portale.*,
// cliente-facing — ADR-0046 §6). I template studio "tutti i permessi" (Super
// Admin / Admin sede / Socio) NON devono ricevere permessi del portale cliente.
const ALL_PERMISSION_CODES = PERMISSIONS.filter((p) => !p.isPortale).map((p) => p.code);

const ROLE_TEMPLATES: RoleTemplateSeed[] = [
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
  {
    name: 'Direzione',
    description: 'Report, anagrafica, menu, cassa, AI. No config tecnica sistema.',
    permissionCodes: [
      'sistema.audit.visualizza',
      'anagrafica.cliente.crea',
      'anagrafica.cliente.modifica',
      'anagrafica.cliente.visualizza',
      'anagrafica.cliente.elimina',
      'anagrafica.fornitore.gestisci',
      'menu.categoria.gestisci',
      'menu.piatto.crea',
      'menu.piatto.modifica',
      'menu.prezzo.modifica',
      'menu.visualizza',
      'tavoli.visualizza',
      'tavoli.gestisci',
      'preventivi.visualizza',
      'preventivi.gestisci',
      'comande.crea',
      'comande.modifica',
      'comande.elimina',
      'comande.visualizza',
      'cassa.scontrino.emetti',
      'cassa.storno.esegui',
      'cassa.chiusura.giornaliera',
      'cassa.visualizza',
      'report.fatturato.visualizza',
      'report.operativo.visualizza',
      'report.export',
      'magazzino.articolo.gestisci',
      'magazzino.movimento.crea',
      'ai.assistant.usa',
    ],
  },
  {
    name: 'Cassiere',
    description: 'Operatore POS: tavoli, cassa, comande di tutti. No report fatturato.',
    permissionCodes: [
      'menu.visualizza',
      'comande.crea',
      'comande.modifica',
      'comande.elimina',
      'comande.visualizza',
      'cassa.scontrino.emetti',
      'cassa.storno.esegui',
      'cassa.chiusura.giornaliera',
      'cassa.visualizza',
      'tavoli.visualizza',
      'report.operativo.visualizza',
    ],
  },
  {
    name: 'Cameriere',
    description: 'Cameriere smartphone: comande proprie + mappa tavoli. No cassa, no report.',
    permissionCodes: [
      'menu.visualizza',
      'tavoli.visualizza',
      'comande.crea',
      'comande.modifica',
      'comande.visualizza',
    ],
  },
  {
    name: 'Cucina/Bar',
    description: 'KDS read-only + cambio stato comande. Nessuna altra azione.',
    permissionCodes: ['menu.visualizza', 'comande.visualizza', 'comande.stato.cambia'],
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

// ─────────────────────────────────────────────────────────────────────────────
// Helper: seed di un tenant dev completo (tenant + sede + user + role + assignments)
// Idempotente: re-run safe. D3b extension per supportare N tenant dev (demo, acme).
// ─────────────────────────────────────────────────────────────────────────────
// Id fisso e well-known del tenant di piattaforma `oneplatform`: il superadmin
// è un utente di questo tenant (decisione Task 3, opzione b — nessuna identità
// platform separata). Deve combaciare con PLATFORM_TENANT_ID in .env, che il
// PlatformGuard confronta con req.user.tenantId. Id stabile = env riferibile.
export const PLATFORM_TENANT_ID = '01900000-0000-7000-8000-000000000001';

interface SeedDevTenantParams {
  // Identità pubblica (ADR-0049): campi opzionali mostrati sulla landing /t/<slug>.
  tenant: {
    slug: string;
    name: string;
    id?: string;
    descrizione?: string;
    indirizzo?: string;
    telefono?: string;
    emailContatto?: string;
    sitoWeb?: string;
    logoUrl?: string;
  };
  sede: { name: string; address: string; city: string; postalCode: string };
  user: { email: string; password: string; firstName: string; lastName: string };
  superAdminTplId: string;
  superAdminTplDescription: string;
  tplPermissions: { permissionId: string }[];
}

async function seedDevTenant(
  params: SeedDevTenantParams,
): Promise<{ tenantId: string; tenantSlug: string }> {
  const { tenant: tenantInfo, sede: sedeInfo, user: userInfo } = params;

  // 1. Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantInfo.slug },
    // id opzionale: il tenant di piattaforma usa un id fisso (PLATFORM_TENANT_ID);
    // gli altri tenant dev usano uuidv7 generato.
    create: {
      id: tenantInfo.id ?? id(),
      name: tenantInfo.name,
      slug: tenantInfo.slug,
      isActive: true,
      descrizione: tenantInfo.descrizione ?? null,
      indirizzo: tenantInfo.indirizzo ?? null,
      telefono: tenantInfo.telefono ?? null,
      emailContatto: tenantInfo.emailContatto ?? null,
      sitoWeb: tenantInfo.sitoWeb ?? null,
      logoUrl: tenantInfo.logoUrl ?? null,
    },
    update: {
      name: tenantInfo.name,
      isActive: true,
      descrizione: tenantInfo.descrizione ?? null,
      indirizzo: tenantInfo.indirizzo ?? null,
      telefono: tenantInfo.telefono ?? null,
      emailContatto: tenantInfo.emailContatto ?? null,
      sitoWeb: tenantInfo.sitoWeb ?? null,
      logoUrl: tenantInfo.logoUrl ?? null,
    },
  });
  console.log(`  Tenant '${tenantInfo.slug}': ${tenant.id}`);

  // 2. Sede (no UNIQUE su tenant_id+name nello schema, manual findFirst+create)
  let sede = await prisma.sede.findFirst({
    where: { tenantId: tenant.id, name: sedeInfo.name },
  });
  if (!sede) {
    sede = await prisma.sede.create({
      data: {
        id: id(),
        tenantId: tenant.id,
        name: sedeInfo.name,
        address: sedeInfo.address,
        city: sedeInfo.city,
        postalCode: sedeInfo.postalCode,
      },
    });
  }
  console.log(`  Sede '${sedeInfo.name}': ${sede.id}`);

  // 3. User con password argon2id
  const passwordHash = await argon2.hash(userInfo.password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: userInfo.email } },
    create: {
      id: id(),
      tenantId: tenant.id,
      email: userInfo.email,
      passwordHash,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      isActive: true,
    },
    update: {
      passwordHash,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      isActive: true,
    },
  });
  console.log(`  User '${userInfo.email}': ${user.id}`);

  // 4. Role Super Admin tenant-scoped (clone dal template)
  // TD-BZ (ADR-0023): rimosso il @@unique compound da Role → find-then-create/
  // update sulla chiave naturale (tenantId+name), come per i 4 modelli Menu.
  const roleData = { description: params.superAdminTplDescription, isSystem: true };
  const existingRole = await prisma.role.findFirst({
    where: { tenantId: tenant.id, name: 'Super Admin' },
  });
  const superAdminRole = existingRole
    ? await prisma.role.update({ where: { id: existingRole.id }, data: roleData })
    : await prisma.role.create({
        data: { id: id(), tenantId: tenant.id, name: 'Super Admin', ...roleData },
      });
  console.log(`  Role 'Super Admin' (tenant '${tenantInfo.slug}'): ${superAdminRole.id}`);

  // 5. Copia mappings template -> role_permissions
  let rolePermCreated = 0;
  let rolePermSkipped = 0;
  for (const tp of params.tplPermissions) {
    const existing = await prisma.rolePermission.findUnique({
      where: {
        roleId_permissionId: { roleId: superAdminRole.id, permissionId: tp.permissionId },
      },
    });
    if (existing) {
      rolePermSkipped++;
    } else {
      await prisma.rolePermission.create({
        data: { roleId: superAdminRole.id, permissionId: tp.permissionId },
      });
      rolePermCreated++;
    }
  }
  console.log(
    `  role_permissions (Super Admin ${tenantInfo.slug}): ${rolePermCreated} created, ${rolePermSkipped} re-affirmed`,
  );

  // 6. Assignment user -> Super Admin tenant-wide (sede_id NULL).
  // Lo unique index parziale "user_roles_tenant_wide_unique" garantisce no
  // duplicati su (user_id, role_id) WHERE sede_id IS NULL.
  const existingAssignment = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: superAdminRole.id, sedeId: null },
  });
  if (!existingAssignment) {
    await prisma.userRole.create({
      data: { id: id(), userId: user.id, roleId: superAdminRole.id, sedeId: null },
    });
    console.log(`  user_roles: ${userInfo.email} -> Super Admin (tenant-wide) created`);
  } else {
    console.log(`  user_roles: ${userInfo.email} -> Super Admin (tenant-wide) already exists`);
  }

  // Il seed DOMINIO (F1 Menu) è orchestrato come fase separata in main()
  // (ADR-0027 §D5 passo 8b-1: confine core/dominio). `seedDevTenant` resta
  // responsabile del solo CORE del tenant e ritorna gli id necessari alla fase
  // dominio top-level.
  return { tenantId: tenant.id, tenantSlug: tenantInfo.slug };
}

interface ArticleSeed {
  name: string;
  descriptionShort: string;
  basePrice: string;
  vatPercent: number;
  categoryName: 'Antipasti' | 'Primi' | 'Pizze';
  printDepartment: 'cucina' | 'pizzeria' | 'bar';
  portata: 'antipasto' | 'primo' | 'secondo' | 'contorno' | 'dolce' | 'bevanda' | 'nessuna';
  allergens: string[];
  dietaryTags: string[];
  preparationTimeMinutes: number;
  sortOrder: number;
}

// 5 articoli dimostrativi (2 antipasti + 1 primo + 2 pizze).
const DEMO_ARTICLES: ArticleSeed[] = [
  {
    name: 'Bruschetta al pomodoro',
    descriptionShort: 'Pane tostato, pomodoro fresco, basilico',
    basePrice: '6.50',
    vatPercent: 10,
    categoryName: 'Antipasti',
    printDepartment: 'cucina',
    portata: 'antipasto',
    allergens: ['cereali_glutine'],
    dietaryTags: ['vegetariano', 'vegano'],
    preparationTimeMinutes: 5,
    sortOrder: 0,
  },
  {
    name: 'Tartare di manzo',
    descriptionShort: 'Manzo battuto al coltello, tuorlo, capperi',
    basePrice: '14.00',
    vatPercent: 10,
    categoryName: 'Antipasti',
    printDepartment: 'cucina',
    portata: 'antipasto',
    allergens: ['uova'],
    dietaryTags: [],
    preparationTimeMinutes: 8,
    sortOrder: 1,
  },
  {
    name: 'Spaghetti alla carbonara',
    descriptionShort: 'Guanciale, uova, pecorino romano, pepe',
    basePrice: '12.00',
    vatPercent: 10,
    categoryName: 'Primi',
    printDepartment: 'cucina',
    portata: 'primo',
    allergens: ['cereali_glutine', 'uova', 'latte'],
    dietaryTags: [],
    preparationTimeMinutes: 12,
    sortOrder: 0,
  },
  {
    name: 'Pizza Margherita',
    descriptionShort: 'Pomodoro, fior di latte, basilico',
    basePrice: '8.00',
    vatPercent: 10,
    categoryName: 'Pizze',
    printDepartment: 'pizzeria',
    portata: 'secondo',
    allergens: ['cereali_glutine', 'latte'],
    dietaryTags: ['vegetariano'],
    preparationTimeMinutes: 7,
    sortOrder: 0,
  },
  {
    name: 'Pizza Diavola',
    descriptionShort: 'Pomodoro, fior di latte, salame piccante',
    basePrice: '10.00',
    vatPercent: 10,
    categoryName: 'Pizze',
    printDepartment: 'pizzeria',
    portata: 'secondo',
    allergens: ['cereali_glutine', 'latte'],
    dietaryTags: ['piccante'],
    preparationTimeMinutes: 7,
    sortOrder: 1,
  },
];

async function seedDevMenu(tenantId: string, tenantSlug: string): Promise<void> {
  // ── 7.1 Menu "Pranzo"
  // TD-BZ (ADR-0023): rimosso il @@unique compound → Prisma non genera più la
  // WhereUniqueInput `tenantId_name` necessaria a `upsert`. Idempotenza via
  // find-then-create/update sulla chiave naturale (tenantId+name) — stesso
  // pattern dei pre-check dei service; il client esteso esclude i soft-deleted.
  const menuData = {
    description: 'Menu pranzo dimostrativo (sessione 17)',
    isActive: true,
  };
  const existingMenu = await prisma.menu.findFirst({ where: { tenantId, name: 'Pranzo' } });
  const menu = existingMenu
    ? await prisma.menu.update({ where: { id: existingMenu.id }, data: menuData })
    : await prisma.menu.create({
        data: { id: id(), tenantId, name: 'Pranzo', sortOrder: 0, ...menuData },
      });
  console.log(`  Menu 'Pranzo' (${tenantSlug}): ${menu.id}`);

  // ── 7.2 Categorie (Antipasti, Primi, Pizze)
  const categoryDefs: Array<{ name: 'Antipasti' | 'Primi' | 'Pizze'; sortOrder: number }> = [
    { name: 'Antipasti', sortOrder: 0 },
    { name: 'Primi', sortOrder: 1 },
    { name: 'Pizze', sortOrder: 2 },
  ];

  const categoryByName = new Map<string, { id: string }>();
  for (const c of categoryDefs) {
    // TD-BZ (ADR-0023): find-then-create/update — vedi nota § 7.1.
    const existingCat = await prisma.menuCategory.findFirst({
      where: { tenantId, menuId: menu.id, name: c.name },
    });
    const cat = existingCat
      ? await prisma.menuCategory.update({
          where: { id: existingCat.id },
          data: { sortOrder: c.sortOrder },
        })
      : await prisma.menuCategory.create({
          data: { id: id(), tenantId, menuId: menu.id, name: c.name, sortOrder: c.sortOrder },
        });
    categoryByName.set(c.name, { id: cat.id });
  }
  console.log(`  Categorie (${tenantSlug}): ${categoryByName.size}`);

  // ── 7.3 Articoli (5)
  const articleByName = new Map<string, { id: string; basePrice: string }>();
  const channelsAll: ('cassa' | 'menu_online' | 'asporto' | 'delivery')[] = [
    'cassa',
    'menu_online',
    'asporto',
    'delivery',
  ];

  for (const a of DEMO_ARTICLES) {
    const category = categoryByName.get(a.categoryName);
    if (!category) throw new Error(`Category missing: ${a.categoryName}`);

    // TD-BZ (ADR-0023): find-then-create/update — vedi nota § 7.1. I campi
    // condivisi create/update vivono in `articleData`; `id`/relazioni/name/
    // availability sono solo del create.
    const articleData = {
      descriptionShort: a.descriptionShort,
      basePrice: a.basePrice,
      vatPercent: a.vatPercent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allergens: a.allergens as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dietaryTags: a.dietaryTags as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      printDepartment: a.printDepartment as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      portata: a.portata as any,
      preparationTimeMinutes: a.preparationTimeMinutes,
      sortOrder: a.sortOrder,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channelVisibility: channelsAll as any,
    };
    const existingArticle = await prisma.article.findFirst({
      where: { tenantId, categoryId: category.id, name: a.name },
    });
    const article = existingArticle
      ? await prisma.article.update({ where: { id: existingArticle.id }, data: articleData })
      : await prisma.article.create({
          data: {
            id: id(),
            tenantId,
            categoryId: category.id,
            name: a.name,
            availability: 'in_carta',
            ...articleData,
          },
        });
    articleByName.set(a.name, { id: article.id, basePrice: a.basePrice });
  }
  console.log(`  Articoli (${tenantSlug}): ${articleByName.size}`);

  // ── 7.4 PriceList "Base"
  // TD-BZ (ADR-0023): find-then-create/update — vedi nota § 7.1.
  const priceListData = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channels: channelsAll as any,
    isActive: true,
  };
  const existingPriceList = await prisma.priceList.findFirst({
    where: { tenantId, name: 'Base' },
  });
  const priceList = existingPriceList
    ? await prisma.priceList.update({ where: { id: existingPriceList.id }, data: priceListData })
    : await prisma.priceList.create({
        data: { id: id(), tenantId, name: 'Base', priority: 0, ...priceListData },
      });
  console.log(`  PriceList 'Base' (${tenantSlug}): ${priceList.id}`);

  // ── 7.5 ArticlePrice (5) — price == basePrice
  let articlePriceCount = 0;
  for (const [name, art] of articleByName) {
    await prisma.articlePrice.upsert({
      where: { articleId_priceListId: { articleId: art.id, priceListId: priceList.id } },
      create: {
        id: id(),
        tenantId,
        articleId: art.id,
        priceListId: priceList.id,
        price: art.basePrice,
      },
      update: { price: art.basePrice },
    });
    articlePriceCount++;
    void name;
  }
  console.log(`  ArticlePrices (${tenantSlug}): ${articlePriceCount}`);
}

// Aziende demo per il verticale commercialisti (STOP-c2 ADR-0032). Idempotente
// via find-then-create sulla chiave naturale (tenantId+codice) — stesso pattern
// del menu (§ 7.1). Gira nel system context ereditato da withSystemContext(main).
async function seedDevAziende(tenantId: string): Promise<void> {
  const demo: Array<{
    codice: string;
    nome: string;
    tipoCliente: TipoCliente;
    partitaIva?: string;
    codiceFiscale?: string;
    email?: string;
    telefono?: string;
    attivo?: boolean;
  }> = [
    {
      codice: 'AZ001',
      nome: 'Rossi Costruzioni S.r.l.',
      tipoCliente: TipoCliente.azienda,
      partitaIva: '01234567890',
      email: 'info@rossicostruzioni.example.com',
      telefono: '+39 02 1234567',
    },
    {
      codice: 'AZ002',
      nome: 'Bianchi & Figli S.n.c.',
      tipoCliente: TipoCliente.azienda,
      partitaIva: '09876543210',
      email: 'amministrazione@bianchifigli.example.com',
    },
    {
      codice: 'AZ003',
      nome: 'Neri Trasporti S.p.A.',
      tipoCliente: TipoCliente.azienda,
      partitaIva: '05555555550',
      attivo: false,
    },
    {
      codice: 'PF001',
      nome: 'Mario Verdi',
      tipoCliente: TipoCliente.persona_fisica,
      codiceFiscale: 'VRDMRA80A01H501Z',
      email: 'mario.verdi@example.com',
    },
    {
      codice: 'PF002',
      nome: 'Anna Gialli',
      tipoCliente: TipoCliente.persona_fisica,
      codiceFiscale: 'GLLNNA85M41H501K',
    },
  ];

  let created = 0;
  for (const a of demo) {
    const existing = await prisma.azienda.findFirst({
      where: { tenantId, codice: a.codice },
    });
    if (existing) continue;
    await prisma.azienda.create({ data: { id: id(), tenantId, ...a } });
    created += 1;
  }
  console.log(`  ✓ aziende studio-demo: ${created} created (${demo.length} total)`);
}

// Referenti demo per studio-demo (STOP-c3b ADR-0034). Agganciati per `codice`
// dell'azienda parent (lookup naturale stabile → niente refactor del return di
// seedDevAziende). Idempotente: find-then-create su (tenantId, aziendaId, nome).
async function seedDevReferenti(tenantId: string): Promise<void> {
  const demo: Array<{
    aziendaCodice: string;
    nome: string;
    ruolo: RuoloReferente;
    email?: string;
    telefono?: string;
    attivo?: boolean;
  }> = [
    {
      aziendaCodice: 'AZ001',
      nome: 'Giulia Rossi',
      ruolo: RuoloReferente.legale_rappresentante,
      email: 'giulia.rossi@rossicostruzioni.example.com',
      telefono: '+39 02 1234568',
    },
    {
      aziendaCodice: 'AZ001',
      nome: 'Marco Ferri',
      ruolo: RuoloReferente.amministrativo,
      email: 'amministrazione@rossicostruzioni.example.com',
    },
    {
      aziendaCodice: 'AZ002',
      nome: 'Laura Bianchi',
      ruolo: RuoloReferente.tecnico,
      telefono: '+39 06 9876543',
      attivo: false,
    },
  ];

  let created = 0;
  for (const r of demo) {
    const azienda = await prisma.azienda.findFirst({
      where: { tenantId, codice: r.aziendaCodice },
      select: { id: true },
    });
    if (!azienda) continue; // azienda parent assente (non dovrebbe, seedDevAziende gira prima)

    const { aziendaCodice: _aziendaCodice, ...data } = r;
    const existing = await prisma.referente.findFirst({
      where: { tenantId, aziendaId: azienda.id, nome: r.nome },
    });
    if (existing) continue;
    await prisma.referente.create({
      data: { id: id(), tenantId, aziendaId: azienda.id, ...data },
    });
    created += 1;
  }
  console.log(`  ✓ referenti studio-demo: ${created} created (${demo.length} total)`);
}

// Preventivi demo per studio-demo (STOP-e2 ADR-0037). Agganciati ad AZ001 per
// `codice` (lookup naturale stabile, come seedDevReferenti). Idempotente:
// find-then-create su (tenantId, codice). Il seed scrive direttamente via prisma
// (bypassa il service) → i 3 totali si calcolano qui REPLICANDO la formula
// server (preventivi.service computeVoce/computeTotali): arrotonda la riga prima
// dell'IVA, IVA per-voce, somma, poi arrotonda gli aggregati. Aliquote miste
// (22% e 10%) per esercitare la formula. PII-free.
async function seedDevPreventivi(tenantId: string): Promise<void> {
  const round2 = (n: number): number => Math.round(n * 100) / 100;

  type VoceSeed = {
    nome: string;
    descrizione?: string;
    unitaMisura: UnitaMisura;
    quantita: number;
    prezzoUnitario: number;
    scontoPct: number;
    ivaAliquota: number;
  };

  const demo: Array<{
    aziendaCodice: string;
    codice: string;
    oggetto: string;
    stato: StatoPreventivo;
    validoFino?: string; // YYYY-MM-DD
    coverLetter?: string;
    voci: VoceSeed[];
  }> = [
    {
      aziendaCodice: 'AZ001',
      codice: 'PREV-2025-001',
      oggetto: 'Consulenza fiscale e contabile annuale',
      stato: StatoPreventivo.bozza,
      coverLetter: 'Proposta per la gestione contabile e fiscale dell’esercizio 2025.',
      voci: [
        {
          nome: 'Tenuta contabilità ordinaria',
          descrizione: 'Registrazioni mensili e adempimenti IVA',
          unitaMisura: UnitaMisura.mese,
          quantita: 12,
          prezzoUnitario: 80,
          scontoPct: 0,
          ivaAliquota: 22,
        },
        {
          nome: 'Dichiarazione dei redditi',
          unitaMisura: UnitaMisura.documento,
          quantita: 1,
          prezzoUnitario: 350,
          scontoPct: 10,
          ivaAliquota: 22,
        },
        {
          nome: 'Diritti camerali e bolli',
          unitaMisura: UnitaMisura.pezzo,
          quantita: 2,
          prezzoUnitario: 16,
          scontoPct: 0,
          ivaAliquota: 10,
        },
      ],
    },
    {
      aziendaCodice: 'AZ001',
      codice: 'PREV-2025-002',
      oggetto: 'Avvio nuova attività e formazione',
      stato: StatoPreventivo.inviato,
      validoFino: '2025-12-31',
      voci: [
        {
          nome: 'Apertura partita IVA',
          unitaMisura: UnitaMisura.forfait,
          quantita: 1,
          prezzoUnitario: 200,
          scontoPct: 0,
          ivaAliquota: 22,
        },
        {
          nome: 'Formazione fatturazione elettronica',
          unitaMisura: UnitaMisura.ora,
          quantita: 3,
          prezzoUnitario: 60,
          scontoPct: 5,
          ivaAliquota: 10,
        },
      ],
    },
  ];

  let created = 0;
  for (const p of demo) {
    const azienda = await prisma.azienda.findFirst({
      where: { tenantId, codice: p.aziendaCodice },
      select: { id: true },
    });
    if (!azienda) continue; // azienda parent assente (seedDevAziende gira prima)

    const existing = await prisma.preventivo.findFirst({
      where: { tenantId, codice: p.codice },
      select: { id: true },
    });
    if (existing) continue;

    // Totali mirror-server: arrotonda riga prima dell'IVA, IVA per-voce.
    let totaleImponibile = 0;
    let totaleIva = 0;
    const vociData = p.voci.map((v, i) => {
      const scontato = v.quantita * v.prezzoUnitario * (1 - v.scontoPct / 100);
      const totaleRiga = round2(scontato);
      const iva = round2(totaleRiga * (v.ivaAliquota / 100));
      totaleImponibile += totaleRiga;
      totaleIva += iva;
      return {
        id: id(),
        tenantId,
        nome: v.nome,
        descrizione: v.descrizione,
        unitaMisura: v.unitaMisura,
        quantita: v.quantita,
        prezzoUnitario: v.prezzoUnitario,
        scontoPct: v.scontoPct,
        ivaAliquota: v.ivaAliquota,
        totaleRiga,
        ordine: i,
      };
    });
    totaleImponibile = round2(totaleImponibile);
    totaleIva = round2(totaleIva);
    const totale = round2(totaleImponibile + totaleIva);

    await prisma.preventivo.create({
      data: {
        id: id(),
        tenantId,
        aziendaId: azienda.id,
        codice: p.codice,
        oggetto: p.oggetto,
        coverLetter: p.coverLetter,
        stato: p.stato,
        validoFino: p.validoFino ? new Date(p.validoFino) : null,
        totaleImponibile,
        totaleIva,
        totale,
        voci: { create: vociData },
      },
    });
    created += 1;
  }
  console.log(`  ✓ preventivi studio-demo: ${created} created (${demo.length} total)`);
}

// Utente non-superuser per studio-demo (chiude il TD candidate di ADR-0037):
// sblocca i test di gating runtime di `preventivi.*` / `anagrafica.cliente.*`,
// che `admin@studio.local` (Super Admin, 35 permessi) non esercita mai. Clona il
// template "Collaboratore" (operativo) in un ruolo tenant-wide e assegna l'utente.
// Stesso impianto core di seedDevTenant (user + role clone + role_permissions +
// assignment tenant-wide). Idempotente: find-then-create su email+tenantId, ruolo
// (tenantId+name), mapping (roleId+permissionId), assignment tenant-wide (sedeId NULL).
async function seedDevCollaboratore(tenantId: string): Promise<void> {
  const ROLE_NAME = 'Collaboratore';
  const EMAIL = 'collaboratore@studio.local';

  // 1. Template "Collaboratore" + i suoi permessi (seedati a monte in main()).
  const tpl = await prisma.systemRoleTemplate.findUnique({ where: { name: ROLE_NAME } });
  if (!tpl) throw new Error(`System template '${ROLE_NAME}' missing`);
  const tplPermissions = await prisma.systemRoleTemplatePermission.findMany({
    where: { templateId: tpl.id },
  });

  // 2. User con password argon2id (find-then-create su tenantId+email).
  const passwordHash = await argon2.hash('Collaboratore123!', { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: EMAIL } },
    create: {
      id: id(),
      tenantId,
      email: EMAIL,
      passwordHash,
      firstName: 'Collaboratore',
      lastName: 'Studio',
      isActive: true,
    },
    update: { passwordHash, isActive: true },
  });
  console.log(`  User '${EMAIL}': ${user.id}`);

  // 3. Role "Collaboratore" tenant-scoped (clone dal template). TD-BZ (ADR-0023):
  // find-then-create/update sulla chiave naturale (tenantId+name), come Super Admin.
  const roleData = { description: tpl.description, isSystem: true };
  const existingRole = await prisma.role.findFirst({ where: { tenantId, name: ROLE_NAME } });
  const role = existingRole
    ? await prisma.role.update({ where: { id: existingRole.id }, data: roleData })
    : await prisma.role.create({
        data: { id: id(), tenantId, name: ROLE_NAME, ...roleData },
      });
  console.log(`  Role '${ROLE_NAME}' (studio-demo): ${role.id}`);

  // 4. Copia mappings template -> role_permissions.
  let rolePermCreated = 0;
  let rolePermSkipped = 0;
  for (const tp of tplPermissions) {
    const existing = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId: tp.permissionId } },
    });
    if (existing) {
      rolePermSkipped++;
    } else {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: tp.permissionId },
      });
      rolePermCreated++;
    }
  }
  console.log(
    `  role_permissions (${ROLE_NAME} studio-demo): ${rolePermCreated} created, ${rolePermSkipped} re-affirmed`,
  );

  // 5. Assignment user -> Collaboratore tenant-wide (sede_id NULL).
  const existingAssignment = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: role.id, sedeId: null },
  });
  if (!existingAssignment) {
    await prisma.userRole.create({
      data: { id: id(), userId: user.id, roleId: role.id, sedeId: null },
    });
    console.log(`  user_roles: ${EMAIL} -> ${ROLE_NAME} (tenant-wide) created`);
  } else {
    console.log(`  user_roles: ${EMAIL} -> ${ROLE_NAME} (tenant-wide) already exists`);
  }
}

// Utente non-superuser per il tenant food `demo` (ADR-0064): sblocca i test di
// gating runtime di `tavoli.*` — in particolare l'e2e drag-persist FE-5 e lo
// smoke per-ruolo (ADR-0059) — che `admin@demo.local` (Super Admin) non esercita
// mai. Clona il template "Direzione" (food, possiede tavoli.visualizza +
// tavoli.gestisci) in un ruolo tenant-wide e assegna l'utente. Stesso impianto
// idempotente di seedDevCollaboratore: find-then-create su email+tenantId, ruolo
// (tenantId+name), mapping (roleId+permissionId), assignment tenant-wide (sedeId NULL).
async function seedDevDirezione(tenantId: string): Promise<void> {
  const ROLE_NAME = 'Direzione';
  const EMAIL = 'direzione@demo.local';

  // 1. Template "Direzione" + i suoi permessi (seedati a monte in main()).
  const tpl = await prisma.systemRoleTemplate.findUnique({ where: { name: ROLE_NAME } });
  if (!tpl) throw new Error(`System template '${ROLE_NAME}' missing`);
  const tplPermissions = await prisma.systemRoleTemplatePermission.findMany({
    where: { templateId: tpl.id },
  });

  // 2. User con password argon2id (find-then-create su tenantId+email).
  const passwordHash = await argon2.hash('Direzione123!', { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: EMAIL } },
    create: {
      id: id(),
      tenantId,
      email: EMAIL,
      passwordHash,
      firstName: 'Direzione',
      lastName: 'Demo',
      isActive: true,
    },
    update: { passwordHash, isActive: true },
  });
  console.log(`  User '${EMAIL}': ${user.id}`);

  // 3. Role "Direzione" tenant-scoped (clone dal template). TD-BZ (ADR-0023):
  // find-then-create/update sulla chiave naturale (tenantId+name), come Super Admin.
  const roleData = { description: tpl.description, isSystem: true };
  const existingRole = await prisma.role.findFirst({ where: { tenantId, name: ROLE_NAME } });
  const role = existingRole
    ? await prisma.role.update({ where: { id: existingRole.id }, data: roleData })
    : await prisma.role.create({
        data: { id: id(), tenantId, name: ROLE_NAME, ...roleData },
      });
  console.log(`  Role '${ROLE_NAME}' (demo): ${role.id}`);

  // 4. Copia mappings template -> role_permissions.
  let rolePermCreated = 0;
  let rolePermSkipped = 0;
  for (const tp of tplPermissions) {
    const existing = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId: tp.permissionId } },
    });
    if (existing) {
      rolePermSkipped++;
    } else {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: tp.permissionId },
      });
      rolePermCreated++;
    }
  }
  console.log(
    `  role_permissions (${ROLE_NAME} demo): ${rolePermCreated} created, ${rolePermSkipped} re-affirmed`,
  );

  // 5. Assignment user -> Direzione tenant-wide (sede_id NULL).
  const existingAssignment = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: role.id, sedeId: null },
  });
  if (!existingAssignment) {
    await prisma.userRole.create({
      data: { id: id(), userId: user.id, roleId: role.id, sedeId: null },
    });
    console.log(`  user_roles: ${EMAIL} -> ${ROLE_NAME} (tenant-wide) created`);
  } else {
    console.log(`  user_roles: ${EMAIL} -> ${ROLE_NAME} (tenant-wide) already exists`);
  }
}

// Tavoli demo per il tenant food `demo` (ADR-0064): target draggabile stabile per
// l'e2e drag-persist FE-5 (la mappa sala richiede ≥1 tavolo). Idempotente sulla
// chiave naturale (tenantId + numero): find-then-create, nessun duplicato a doppia
// esecuzione. Coordinate iniziali distinte così il drag ha una posizione nota.
async function seedDevTavoli(tenantId: string): Promise<void> {
  const demo: Array<{ numero: string; capienza: number; posX: number; posY: number }> = [
    { numero: '1', capienza: 4, posX: 40, posY: 40 },
    { numero: '2', capienza: 2, posX: 200, posY: 40 },
  ];

  let created = 0;
  for (const tv of demo) {
    const existing = await prisma.tavolo.findFirst({ where: { tenantId, numero: tv.numero } });
    if (existing) continue;
    await prisma.tavolo.create({ data: { id: id(), tenantId, ...tv } });
    created++;
  }
  console.log(`  ✓ tavoli demo: ${created} created (${demo.length} total)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente demo del portale (ADR-0046 DP-defer §7): l'onboarding reale è via
// invito (differito), qui seedo direttamente un utente tipo=cliente legato a
// un'azienda demo per la verifica runtime del portale ruolo-cliente.
// Pattern identico a seedDevCollaboratore. Idempotente.
// ─────────────────────────────────────────────────────────────────────────────
async function seedDevClientePortale(tenantId: string): Promise<void> {
  const ROLE_NAME = 'Cliente';
  const EMAIL = 'cliente@studio-demo.local';
  const AZIENDA_CODICE = 'AZ001'; // Rossi Costruzioni S.r.l. (seedDevAziende)

  // 0. Azienda di appartenenza: lookup naturale per codice (deve esistere —
  // seedDevAziende gira prima in main()). Senza azienda il CHECK DB
  // chk_cliente_azienda_id rifiuterebbe un cliente orfano (ADR-0046 §2).
  const azienda = await prisma.azienda.findFirst({
    where: { tenantId, codice: AZIENDA_CODICE },
  });
  if (!azienda)
    throw new Error(`Azienda demo '${AZIENDA_CODICE}' missing (run seedDevAziende first)`);

  // 1. Template "Cliente" + i suoi permessi (seedati a monte in main()).
  const tpl = await prisma.systemRoleTemplate.findUnique({ where: { name: ROLE_NAME } });
  if (!tpl) throw new Error(`System template '${ROLE_NAME}' missing`);
  const tplPermissions = await prisma.systemRoleTemplatePermission.findMany({
    where: { templateId: tpl.id },
  });

  // 2. User tipo=cliente (find-then-create su tenantId+email). aziendaId NOT NULL
  // + clienteRuolo=admin (auto-promote: primo utente azienda → admin, legacy).
  const passwordHash = await argon2.hash('Cliente123!', { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: EMAIL } },
    create: {
      id: id(),
      tenantId,
      email: EMAIL,
      passwordHash,
      firstName: 'Cliente',
      lastName: 'Rossi',
      isActive: true,
      tipo: UserTipo.cliente,
      aziendaId: azienda.id,
      clienteRuolo: ClienteRuolo.admin,
    },
    update: {
      passwordHash,
      isActive: true,
      tipo: UserTipo.cliente,
      aziendaId: azienda.id,
      clienteRuolo: ClienteRuolo.admin,
    },
  });
  console.log(`  User '${EMAIL}': ${user.id} (cliente → azienda ${AZIENDA_CODICE})`);

  // 3. Role "Cliente" tenant-scoped (clone dal template). TD-BZ: find-then-create.
  const roleData = { description: tpl.description, isSystem: true };
  const existingRole = await prisma.role.findFirst({ where: { tenantId, name: ROLE_NAME } });
  const role = existingRole
    ? await prisma.role.update({ where: { id: existingRole.id }, data: roleData })
    : await prisma.role.create({
        data: { id: id(), tenantId, name: ROLE_NAME, ...roleData },
      });
  console.log(`  Role '${ROLE_NAME}' (studio-demo): ${role.id}`);

  // 4. Copia mappings template -> role_permissions.
  let rolePermCreated = 0;
  let rolePermSkipped = 0;
  for (const tp of tplPermissions) {
    const existing = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId: tp.permissionId } },
    });
    if (existing) {
      rolePermSkipped++;
    } else {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: tp.permissionId },
      });
      rolePermCreated++;
    }
  }
  console.log(
    `  role_permissions (${ROLE_NAME} studio-demo): ${rolePermCreated} created, ${rolePermSkipped} re-affirmed`,
  );

  // 5. Assignment user -> Cliente tenant-wide (sede_id NULL).
  const existingAssignment = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: role.id, sedeId: null },
  });
  if (!existingAssignment) {
    await prisma.userRole.create({
      data: { id: id(), userId: user.id, roleId: role.id, sedeId: null },
    });
    console.log(`  user_roles: ${EMAIL} -> ${ROLE_NAME} (tenant-wide) created`);
  } else {
    console.log(`  user_roles: ${EMAIL} -> ${ROLE_NAME} (tenant-wide) already exists`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Categorie scadenze piattaforma (STOP-scad1) — tenant_id NULL, immutabili.
// Reference data globale (come permissions): seedate sempre, non dev-only.
// Idempotente: find-then-create su `nome` WHERE tenant_id IS NULL (la
// scadenze_categorie NON ha RLS → niente system-context speciale necessario, ma
// l'intero seed gira comunque in withSystemContext).
// ─────────────────────────────────────────────────────────────────────────────
interface ScadenzaCategoriaSeed {
  nome: string;
  colore: string;
}

const SCADENZE_CATEGORIE_PIATTAFORMA: ScadenzaCategoriaSeed[] = [
  { nome: 'Dichiarativi', colore: '#7c3aed' },
  { nome: 'Versamenti', colore: '#dc2626' },
  { nome: 'Adempimenti', colore: '#0e7490' },
  { nome: 'Bilancio', colore: '#b45309' },
  { nome: 'Lavoro e Paghe', colore: '#15803d' },
  { nome: 'Scadenze CIE/Documenti', colore: '#64748b' },
  { nome: 'Altro', colore: '#94a3b8' },
];

async function seedScadenzeCategorie(): Promise<void> {
  console.log(`Scadenze categorie (piattaforma): ${SCADENZE_CATEGORIE_PIATTAFORMA.length} attese`);
  let created = 0;
  let skipped = 0;
  for (const [i, cat] of SCADENZE_CATEGORIE_PIATTAFORMA.entries()) {
    // find-then-create su (nome, tenant_id IS NULL): il partial-unique copre solo
    // le custom (tenant_id NOT NULL) → l'idempotenza piattaforma e' applicativa.
    const existing = await prisma.scadenzaCategoria.findFirst({
      where: { nome: cat.nome, tenantId: null },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.scadenzaCategoria.create({
      data: { id: id(), tenantId: null, nome: cat.nome, colore: cat.colore, ordine: i },
    });
    created++;
  }
  console.log(`  -> ${created} created, ${skipped} re-affirmed\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipi documento piattaforma (ADR-0044) — tenant_id NULL, immutabili. I 16 tipi
// base del PHP StudioDesk. `visibilita_default` 'utente' del PHP è rimappata a
// 'azienda' (l'enum MVP non ha 'utente', backlog). Idempotente: find-then-create
// su `nome` WHERE tenant_id IS NULL (il partial-unique copre solo le custom).
// ─────────────────────────────────────────────────────────────────────────────
interface DocumentoTipoSeed {
  nome: string;
  direzione: 'studio_cliente' | 'cliente_studio' | 'bidirezionale';
  visibilitaDefault: 'tutti' | 'azienda';
}

const DOCUMENTI_TIPI_PIATTAFORMA: DocumentoTipoSeed[] = [
  // Studio → Cliente
  { nome: 'Dichiarazione dei redditi', direzione: 'studio_cliente', visibilitaDefault: 'azienda' },
  { nome: 'F24 da pagare', direzione: 'studio_cliente', visibilitaDefault: 'azienda' },
  {
    nome: 'Bilancio / Situazione contabile',
    direzione: 'studio_cliente',
    visibilitaDefault: 'azienda',
  },
  { nome: 'Cedolino paga', direzione: 'studio_cliente', visibilitaDefault: 'azienda' },
  { nome: 'CU - Certificazione Unica', direzione: 'studio_cliente', visibilitaDefault: 'azienda' },
  { nome: 'Modello 770', direzione: 'studio_cliente', visibilitaDefault: 'azienda' },
  { nome: 'Circolare / Comunicazione', direzione: 'studio_cliente', visibilitaDefault: 'tutti' },
  { nome: 'Visura camerale', direzione: 'studio_cliente', visibilitaDefault: 'azienda' },
  { nome: 'Contratto / Atto', direzione: 'studio_cliente', visibilitaDefault: 'azienda' },
  // Cliente → Studio
  { nome: 'Fattura attiva/passiva', direzione: 'cliente_studio', visibilitaDefault: 'tutti' },
  { nome: 'Estratto conto bancario', direzione: 'cliente_studio', visibilitaDefault: 'tutti' },
  { nome: 'Note spese / Ricevute', direzione: 'cliente_studio', visibilitaDefault: 'tutti' },
  { nome: 'Documento di identità', direzione: 'cliente_studio', visibilitaDefault: 'azienda' },
  { nome: 'Presenze / Ore lavorate', direzione: 'cliente_studio', visibilitaDefault: 'azienda' },
  { nome: 'Documenti nuova assunzione', direzione: 'cliente_studio', visibilitaDefault: 'azienda' },
  // Bidirezionale
  { nome: 'Altro', direzione: 'bidirezionale', visibilitaDefault: 'tutti' },
];

async function seedDocumentiTipi(): Promise<void> {
  console.log(`Documenti tipi (piattaforma): ${DOCUMENTI_TIPI_PIATTAFORMA.length} attesi`);
  let created = 0;
  let skipped = 0;
  for (const [i, tipo] of DOCUMENTI_TIPI_PIATTAFORMA.entries()) {
    const existing = await prisma.documentoTipo.findFirst({
      where: { nome: tipo.nome, tenantId: null },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.documentoTipo.create({
      data: {
        id: id(),
        tenantId: null,
        nome: tipo.nome,
        direzione: tipo.direzione,
        visibilitaDefault: tipo.visibilitaDefault,
        ordine: i,
      },
    });
    created++;
  }
  console.log(`  -> ${created} created, ${skipped} re-affirmed\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogo servizi piattaforma (ADR-0050) — tenant_id NULL, condivisi a tutti i
// tenant. 6 categorie + 20 voci. Idempotente: upsert su `id` fisso well-known
// (i servizi referenziano le categorie per id). Le righe platform non sono
// vincolate dal partial-unique (che copre solo le custom tenant_id NOT NULL).
// ─────────────────────────────────────────────────────────────────────────────
const CATALOGO_CATEGORIE_PIATTAFORMA = [
  { id: '01900000-0001-7000-8000-000000000001', nome: 'Contabilità', colore: '#6366f1', ordine: 1 },
  {
    id: '01900000-0001-7000-8000-000000000002',
    nome: 'Dichiarazioni fiscali',
    colore: '#f59e0b',
    ordine: 2,
  },
  {
    id: '01900000-0001-7000-8000-000000000003',
    nome: 'Lavoro e paghe',
    colore: '#10b981',
    ordine: 3,
  },
  {
    id: '01900000-0001-7000-8000-000000000004',
    nome: 'Societario e legale',
    colore: '#3b82f6',
    ordine: 4,
  },
  { id: '01900000-0001-7000-8000-000000000005', nome: 'Consulenza', colore: '#8b5cf6', ordine: 5 },
  { id: '01900000-0001-7000-8000-000000000006', nome: 'Altro', colore: '#6b7280', ordine: 6 },
];

interface CatalogoServizioSeed {
  id: string;
  codice: string;
  nome: string;
  categoriaId: string;
  unitaMisura: UnitaMisura;
  prezzoBase: number;
  tipoRicorrenza: TipoRicorrenza;
}

const CATALOGO_SERVIZI_PIATTAFORMA: CatalogoServizioSeed[] = [
  // Contabilità
  {
    id: '01900000-0002-7000-8000-000000000001',
    codice: 'CONT-01',
    nome: 'Tenuta contabilità ordinaria',
    categoriaId: '01900000-0001-7000-8000-000000000001',
    unitaMisura: UnitaMisura.mese,
    prezzoBase: 150,
    tipoRicorrenza: TipoRicorrenza.mensile,
  },
  {
    id: '01900000-0002-7000-8000-000000000002',
    codice: 'CONT-02',
    nome: 'Tenuta contabilità semplificata',
    categoriaId: '01900000-0001-7000-8000-000000000001',
    unitaMisura: UnitaMisura.mese,
    prezzoBase: 80,
    tipoRicorrenza: TipoRicorrenza.mensile,
  },
  {
    id: '01900000-0002-7000-8000-000000000003',
    codice: 'CONT-03',
    nome: 'Registrazione fatture (forfait mensile)',
    categoriaId: '01900000-0001-7000-8000-000000000001',
    unitaMisura: UnitaMisura.mese,
    prezzoBase: 60,
    tipoRicorrenza: TipoRicorrenza.mensile,
  },
  {
    id: '01900000-0002-7000-8000-000000000004',
    codice: 'CONT-04',
    nome: 'Chiusura bilancio annuale',
    categoriaId: '01900000-0001-7000-8000-000000000001',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 800,
    tipoRicorrenza: TipoRicorrenza.annuale,
  },
  // Dichiarazioni fiscali
  {
    id: '01900000-0002-7000-8000-000000000005',
    codice: 'FISC-01',
    nome: 'Dichiarazione redditi persone fisiche (730)',
    categoriaId: '01900000-0001-7000-8000-000000000002',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 120,
    tipoRicorrenza: TipoRicorrenza.annuale,
  },
  {
    id: '01900000-0002-7000-8000-000000000006',
    codice: 'FISC-02',
    nome: 'Dichiarazione redditi società (Redditi SC)',
    categoriaId: '01900000-0001-7000-8000-000000000002',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 600,
    tipoRicorrenza: TipoRicorrenza.annuale,
  },
  {
    id: '01900000-0002-7000-8000-000000000007',
    codice: 'FISC-03',
    nome: 'Dichiarazione IVA annuale',
    categoriaId: '01900000-0001-7000-8000-000000000002',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 180,
    tipoRicorrenza: TipoRicorrenza.annuale,
  },
  {
    id: '01900000-0002-7000-8000-000000000008',
    codice: 'FISC-04',
    nome: 'Liquidazione IVA periodica',
    categoriaId: '01900000-0001-7000-8000-000000000002',
    unitaMisura: UnitaMisura.mese,
    prezzoBase: 40,
    tipoRicorrenza: TipoRicorrenza.mensile,
  },
  // Lavoro e paghe
  {
    id: '01900000-0002-7000-8000-000000000009',
    codice: 'LAV-01',
    nome: 'Elaborazione busta paga',
    categoriaId: '01900000-0001-7000-8000-000000000003',
    unitaMisura: UnitaMisura.dipendente,
    prezzoBase: 25,
    tipoRicorrenza: TipoRicorrenza.mensile,
  },
  {
    id: '01900000-0002-7000-8000-000000000010',
    codice: 'LAV-02',
    nome: 'Assunzione / cessazione dipendente',
    categoriaId: '01900000-0001-7000-8000-000000000003',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 80,
    tipoRicorrenza: TipoRicorrenza.una_tantum,
  },
  {
    id: '01900000-0002-7000-8000-000000000011',
    codice: 'LAV-03',
    nome: 'CU dipendenti / autonomi',
    categoriaId: '01900000-0001-7000-8000-000000000003',
    unitaMisura: UnitaMisura.documento,
    prezzoBase: 15,
    tipoRicorrenza: TipoRicorrenza.annuale,
  },
  {
    id: '01900000-0002-7000-8000-000000000012',
    codice: 'LAV-04',
    nome: "770 sostituti d'imposta",
    categoriaId: '01900000-0001-7000-8000-000000000003',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 200,
    tipoRicorrenza: TipoRicorrenza.annuale,
  },
  // Societario e legale
  {
    id: '01900000-0002-7000-8000-000000000013',
    codice: 'SOC-01',
    nome: 'Costituzione società',
    categoriaId: '01900000-0001-7000-8000-000000000004',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 1200,
    tipoRicorrenza: TipoRicorrenza.una_tantum,
  },
  {
    id: '01900000-0002-7000-8000-000000000014',
    codice: 'SOC-02',
    nome: 'Deposito bilancio CCIAA',
    categoriaId: '01900000-0001-7000-8000-000000000004',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 150,
    tipoRicorrenza: TipoRicorrenza.annuale,
  },
  {
    id: '01900000-0002-7000-8000-000000000015',
    codice: 'SOC-03',
    nome: 'Verbale assemblea soci',
    categoriaId: '01900000-0001-7000-8000-000000000004',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 200,
    tipoRicorrenza: TipoRicorrenza.una_tantum,
  },
  // Consulenza
  {
    id: '01900000-0002-7000-8000-000000000016',
    codice: 'CONS-01',
    nome: 'Consulenza oraria',
    categoriaId: '01900000-0001-7000-8000-000000000005',
    unitaMisura: UnitaMisura.ora,
    prezzoBase: 90,
    tipoRicorrenza: TipoRicorrenza.una_tantum,
  },
  {
    id: '01900000-0002-7000-8000-000000000017',
    codice: 'CONS-02',
    nome: 'Piano industriale / business plan',
    categoriaId: '01900000-0001-7000-8000-000000000005',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 1500,
    tipoRicorrenza: TipoRicorrenza.una_tantum,
  },
  {
    id: '01900000-0002-7000-8000-000000000018',
    codice: 'CONS-03',
    nome: 'Due diligence contabile',
    categoriaId: '01900000-0001-7000-8000-000000000005',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 2000,
    tipoRicorrenza: TipoRicorrenza.una_tantum,
  },
  // Altro
  {
    id: '01900000-0002-7000-8000-000000000019',
    codice: 'ALTRO-01',
    nome: 'Visura camerale / catastale',
    categoriaId: '01900000-0001-7000-8000-000000000006',
    unitaMisura: UnitaMisura.documento,
    prezzoBase: 20,
    tipoRicorrenza: TipoRicorrenza.una_tantum,
  },
  {
    id: '01900000-0002-7000-8000-000000000020',
    codice: 'ALTRO-02',
    nome: 'Pratiche SUAP / SCIA',
    categoriaId: '01900000-0001-7000-8000-000000000006',
    unitaMisura: UnitaMisura.forfait,
    prezzoBase: 300,
    tipoRicorrenza: TipoRicorrenza.una_tantum,
  },
];

async function seedCatalogoServizi(): Promise<void> {
  console.log(
    `Catalogo (piattaforma): ${CATALOGO_CATEGORIE_PIATTAFORMA.length} categorie + ${CATALOGO_SERVIZI_PIATTAFORMA.length} voci attese`,
  );
  for (const cat of CATALOGO_CATEGORIE_PIATTAFORMA) {
    await prisma.servizioCategoria.upsert({
      where: { id: cat.id },
      update: { nome: cat.nome, colore: cat.colore, ordine: cat.ordine },
      create: { ...cat, tenantId: null },
    });
  }
  for (const s of CATALOGO_SERVIZI_PIATTAFORMA) {
    await prisma.servizioCatalogo.upsert({
      where: { id: s.id },
      update: { nome: s.nome, prezzoBase: s.prezzoBase, tipoRicorrenza: s.tipoRicorrenza },
      create: {
        ...s,
        tenantId: null,
        ivaAliquota: 22,
        attivo: true,
      },
    });
  }
  console.log(
    `  -> ${CATALOGO_CATEGORIE_PIATTAFORMA.length} categorie + ${CATALOGO_SERVIZI_PIATTAFORMA.length} voci affermate\n`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed runner
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== Seed Gestionale data layer ===\n');

  // ───────────────────────────────────────────────────────────────────────────
  // Permissions: upsert su `code` unique
  // ───────────────────────────────────────────────────────────────────────────
  console.log(`Permissions: ${PERMISSIONS.length} attese`);
  let permCreated = 0;
  let permUpdated = 0;
  for (const p of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { code: p.code } });
    await prisma.permission.upsert({
      where: { code: p.code },
      create: {
        id: id(),
        code: p.code,
        description: p.description,
        category: p.category,
        isPreF2: p.isPreF2 ?? false,
      },
      update: {
        description: p.description,
        category: p.category,
        isPreF2: p.isPreF2 ?? false,
      },
    });
    if (existing) permUpdated++;
    else permCreated++;
  }
  console.log(`  -> ${permCreated} created, ${permUpdated} updated\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // System role templates: upsert su `name` unique
  // ───────────────────────────────────────────────────────────────────────────
  console.log(`System role templates: ${ROLE_TEMPLATES.length} attesi`);
  let tplCreated = 0;
  let tplUpdated = 0;
  for (const t of ROLE_TEMPLATES) {
    const existing = await prisma.systemRoleTemplate.findUnique({ where: { name: t.name } });
    await prisma.systemRoleTemplate.upsert({
      where: { name: t.name },
      create: {
        id: id(),
        name: t.name,
        description: t.description,
        isDefault: true,
      },
      update: {
        description: t.description,
        isDefault: true,
      },
    });
    if (existing) tplUpdated++;
    else tplCreated++;
  }
  console.log(`  -> ${tplCreated} created, ${tplUpdated} updated\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Mappings template <-> permission: upsert su PK composta
  // ───────────────────────────────────────────────────────────────────────────
  console.log('Template -> Permission mappings:');
  let mapCreated = 0;
  let mapUpdated = 0;
  let mapTotal = 0;

  // Lookup map (id by code/name) per evitare N+1 query in loop.
  const allPermissions = await prisma.permission.findMany();
  const permIdByCode = new Map(
    allPermissions.map((p: { code: string; id: string }) => [p.code, p.id]),
  );

  const allTemplates = await prisma.systemRoleTemplate.findMany();
  const tplIdByName = new Map(
    allTemplates.map((t: { name: string; id: string }) => [t.name, t.id]),
  );

  for (const t of ROLE_TEMPLATES) {
    const tplId = tplIdByName.get(t.name);
    if (!tplId) throw new Error(`Template not found: ${t.name}`);
    let perRole = 0;
    for (const code of t.permissionCodes) {
      const permId = permIdByCode.get(code);
      if (!permId) throw new Error(`Permission not found: ${code} (referenced by '${t.name}')`);
      const existing = await prisma.systemRoleTemplatePermission.findUnique({
        where: { templateId_permissionId: { templateId: tplId, permissionId: permId } },
      });
      await prisma.systemRoleTemplatePermission.upsert({
        where: { templateId_permissionId: { templateId: tplId, permissionId: permId } },
        create: { templateId: tplId, permissionId: permId },
        update: {},
      });
      if (existing) mapUpdated++;
      else mapCreated++;
      perRole++;
      mapTotal++;
    }
    console.log(`  '${t.name}': ${perRole} permissions`);
  }
  console.log(`  -> ${mapCreated} created, ${mapUpdated} re-affirmed, ${mapTotal} total\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Categorie scadenze piattaforma (tenant_id NULL) — reference data globale,
  // come permessi/template: seedate SEMPRE (anche in production), non dev-only.
  // ───────────────────────────────────────────────────────────────────────────
  await seedScadenzeCategorie();

  // Tipi documento piattaforma (tenant_id NULL) — reference data globale (ADR-0044).
  await seedDocumentiTipi();

  // Catalogo servizi piattaforma (tenant_id NULL) — reference data globale (ADR-0050).
  await seedCatalogoServizi();

  // ───────────────────────────────────────────────────────────────────────────
  // Dev tenants + admin (opt-out via NODE_ENV=production)
  // ───────────────────────────────────────────────────────────────────────────
  // Crea 2 tenant dev:
  //   - demo  (admin@demo.local / Admin123!)        — esistente da D2a
  //   - acme  (manager@acme.local / Manager123!)   — nuovo D3b per smoke RLS
  //
  // Per ogni tenant: sede + user + clone Super Admin template + role_permissions
  // + assignment tenant-wide. Idempotente: re-run safe.
  //
  // Solo dev locale. Per skippare: NODE_ENV=production prisma db seed.
  // ───────────────────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    console.log('Dev data (NODE_ENV != "production"):');

    // Carica una volta il template Super Admin (riusato per tutti i tenant)
    const superAdminTpl = await prisma.systemRoleTemplate.findUnique({
      where: { name: 'Super Admin' },
    });
    if (!superAdminTpl) throw new Error("System template 'Super Admin' missing");
    const tplPermissions = await prisma.systemRoleTemplatePermission.findMany({
      where: { templateId: superAdminTpl.id },
    });

    const demo = await seedDevTenant({
      tenant: { slug: 'demo', name: 'Demo Pizzeria' },
      sede: {
        name: 'Sede Principale',
        address: 'Via Roma 1',
        city: 'Milano',
        postalCode: '20100',
      },
      user: {
        email: 'admin@demo.local',
        password: 'Admin123!',
        firstName: 'Admin',
        lastName: 'Demo',
      },
      superAdminTplId: superAdminTpl.id,
      superAdminTplDescription: superAdminTpl.description,
      tplPermissions,
    });

    const acme = await seedDevTenant({
      tenant: { slug: 'acme', name: 'Pizzeria Acme' },
      sede: {
        name: 'Sede Centro',
        address: 'Via Garibaldi 1',
        city: 'Roma',
        postalCode: '00100',
      },
      user: {
        email: 'manager@acme.local',
        password: 'Manager123!',
        firstName: 'Manager',
        lastName: 'Acme',
      },
      superAdminTplId: superAdminTpl.id,
      superAdminTplDescription: superAdminTpl.description,
      tplPermissions,
    });

    // Tenant dedicato al 2° verticale (commercialisti / StudioDesk, STOP-b).
    // Isola lo skeleton accountant-api dalla ristorazione: NESSUN seedDevMenu
    // (zero dominio). Idempotente come demo/acme.
    const studio = await seedDevTenant({
      // Identità pubblica demo (ADR-0049): landing /t/studio-demo.
      tenant: {
        slug: 'studio-demo',
        name: 'Studio Ferretti & Lombardi',
        descrizione:
          'Studio di commercialisti e consulenti del lavoro. Assistenza fiscale, contabile e societaria per imprese e professionisti dal 1998.',
        indirizzo: 'Via Manzoni 14, 20121 Milano (MI)',
        telefono: '+39 02 1234 5678',
        emailContatto: 'info@ferrettilombardi.it',
        sitoWeb: 'https://www.ferrettilombardi.it',
        logoUrl: 'https://placehold.co/240x240/1e3a5f/ffffff/png?text=F%26L',
      },
      sede: {
        name: 'Sede Studio',
        address: 'Via Roma 1',
        city: 'Milano',
        postalCode: '20100',
      },
      user: {
        email: 'admin@studio.local',
        password: 'Studio123!',
        firstName: 'Admin',
        lastName: 'Studio',
      },
      superAdminTplId: superAdminTpl.id,
      superAdminTplDescription: superAdminTpl.description,
      tplPermissions,
    });
    await seedDevAziende(studio.tenantId);
    await seedDevReferenti(studio.tenantId);
    await seedDevPreventivi(studio.tenantId);
    await seedDevCollaboratore(studio.tenantId);
    await seedDevClientePortale(studio.tenantId);

    // Tenant di PIATTAFORMA `oneplatform` (Task 3 — superadmin minimale). Id
    // FISSO (PLATFORM_TENANT_ID) per essere riferibile da .env. Il suo Super
    // Admin è il superadmin di piattaforma: ha sistema.tenant.gestisci e (via
    // PLATFORM_TENANT_ID) accede agli endpoint /platform/*. Nessuna identità
    // platform separata (decisione opzione b). Nessun dato di dominio.
    await seedDevTenant({
      tenant: { slug: 'oneplatform', name: 'OnePlatform', id: PLATFORM_TENANT_ID },
      sede: {
        name: 'Sede Piattaforma',
        address: 'Via Piattaforma 1',
        city: 'Milano',
        postalCode: '20100',
      },
      user: {
        email: 'superadmin@oneplatform.local',
        password: 'Superadmin123!',
        firstName: 'Super',
        lastName: 'Admin',
      },
      superAdminTplId: superAdminTpl.id,
      superAdminTplDescription: superAdminTpl.description,
      tplPermissions,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Fase DOMINIO (verticale ristorazione, F1 Menu — ADR-0019 / ADR-0027 §D5
    // passo 8b-1): estratta dal core del tenant e orchestrata qui al top-level.
    // Menu "Pranzo" + 3 categorie + 5 articoli + 1 PriceList "Base" + 5
    // ArticlePrice per ciascun tenant dev. Gira nello stesso system context
    // ereditato da withSystemContext(main). Dev-only come il resto del seed dev.
    // ─────────────────────────────────────────────────────────────────────────
    console.log('Dev data — dominio (F1 Menu):');
    await seedDevMenu(demo.tenantId, demo.tenantSlug);
    await seedDevMenu(acme.tenantId, acme.tenantSlug);

    // F2 Tavoli (ADR-0058) + utente per-ruolo food (ADR-0064): utente Direzione
    // non-super (tavoli.gestisci) + tavoli demo sul tenant `demo`, per l'e2e
    // drag-persist FE-5 e lo smoke per-ruolo (ADR-0059). NON tocca seedDevTenant
    // né i ruoli Super Admin: aggiunto esplicitamente accanto ad admin@demo.local.
    console.log('Dev data — dominio (F2 Tavoli, utente Direzione):');
    await seedDevDirezione(demo.tenantId);
    await seedDevTavoli(demo.tenantId);

    console.log('');
  } else {
    console.log('Dev data: SKIPPED (NODE_ENV=production)\n');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sommario finale
  // ───────────────────────────────────────────────────────────────────────────
  console.log('=== Seed summary ===');
  console.log(`  Permissions:           ${PERMISSIONS.length}`);
  console.log(`  Role templates:        ${ROLE_TEMPLATES.length}`);
  console.log(`  Total mappings:        ${mapTotal}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`  Dev tenants:`);
    console.log(`    - demo  (admin@demo.local / Admin123!)`);
    console.log(`        + direzione@demo.local (ruolo Direzione, non-super — tavoli.gestisci)`);
    console.log(`    - acme  (manager@acme.local / Manager123!)`);
    console.log(`    - studio-demo  (admin@studio.local / Studio123!)`);
    console.log(`        + collaboratore@studio.local / Collaboratore123! (ruolo Collaboratore)`);
    console.log(`        + cliente@studio-demo.local / Cliente123! (portale cliente → AZ001)`);
    console.log(
      `    - oneplatform  (superadmin@oneplatform.local / Superadmin123!) → PLATFORM_TENANT_ID`,
    );
  }
  console.log('  ✅ Seed completato (idempotente).');
}

// Seed gira in system context: is_super_admin=true bypassa RLS policy
// (placeholder USING(true) in D3a, super_admin OR match in D3b). Tutte le
// upsert / create / findUnique downstream ereditano l'ALS via async_hooks.
// Vedi ADR-0009.
withSystemContext(() => main())
  .catch(async (err) => {
    console.error('\n❌ Seed failure:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
