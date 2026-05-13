// =============================================================================
// seed.ts — Seed idempotente per il data layer Gestionale
// =============================================================================
// Popola due cataloghi globali (no tenant_id):
//
//   1. permissions          (32 permessi atomici namespaced)
//   2. system_role_templates (6 template predefiniti F1, isDefault: true)
//      + system_role_template_permissions (mapping role -> permissions)
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

import { id, prisma, withSystemContext } from '../src/index';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Permission catalog (32 atomici)
// ─────────────────────────────────────────────────────────────────────────────
// Categoria = primo segmento prima del primo punto.
// isPreF2 = true per feature [PRE F2] ancora non attive (magazzino.*, ai.*).
// ─────────────────────────────────────────────────────────────────────────────
interface PermissionSeed {
  code: string;
  description: string;
  category: string;
  isPreF2?: boolean;
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

  // anagrafica.* (4)
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
    code: 'anagrafica.fornitore.gestisci',
    description: 'Gestione fornitori',
    category: 'anagrafica',
  },

  // menu.* (5)
  { code: 'menu.categoria.gestisci', description: 'Gestione categorie menu', category: 'menu' },
  { code: 'menu.piatto.crea', description: 'Creazione piatti/articoli', category: 'menu' },
  { code: 'menu.piatto.modifica', description: 'Modifica piatti/articoli', category: 'menu' },
  { code: 'menu.prezzo.modifica', description: 'Modifica prezzi e listini', category: 'menu' },
  { code: 'menu.visualizza', description: 'Visualizzazione menu', category: 'menu' },

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
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. System role templates (6 ruoli predefiniti F1, isDefault: true)
// ─────────────────────────────────────────────────────────────────────────────
interface RoleTemplateSeed {
  name: string;
  description: string;
  permissionCodes: string[];
}

// Helper: tutti i codici permission del catalog.
const ALL_PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

const ROLE_TEMPLATES: RoleTemplateSeed[] = [
  {
    name: 'Super Admin',
    description: 'Accesso completo a tutte le funzioni della piattaforma.',
    // Tutti i 32 permessi.
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
      'anagrafica.fornitore.gestisci',
      'menu.categoria.gestisci',
      'menu.piatto.crea',
      'menu.piatto.modifica',
      'menu.prezzo.modifica',
      'menu.visualizza',
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
      'report.operativo.visualizza',
    ],
  },
  {
    name: 'Cameriere',
    description: 'Cameriere smartphone: comande proprie + mappa tavoli. No cassa, no report.',
    permissionCodes: ['menu.visualizza', 'comande.crea', 'comande.modifica', 'comande.visualizza'],
  },
  {
    name: 'Cucina/Bar',
    description: 'KDS read-only + cambio stato comande. Nessuna altra azione.',
    permissionCodes: ['menu.visualizza', 'comande.visualizza', 'comande.stato.cambia'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper: seed di un tenant dev completo (tenant + sede + user + role + assignments)
// Idempotente: re-run safe. D3b extension per supportare N tenant dev (demo, acme).
// ─────────────────────────────────────────────────────────────────────────────
interface SeedDevTenantParams {
  tenant: { slug: string; name: string };
  sede: { name: string; address: string; city: string; postalCode: string };
  user: { email: string; password: string; firstName: string; lastName: string };
  superAdminTplId: string;
  superAdminTplDescription: string;
  tplPermissions: { permissionId: string }[];
}

async function seedDevTenant(params: SeedDevTenantParams): Promise<void> {
  const { tenant: tenantInfo, sede: sedeInfo, user: userInfo } = params;

  // 1. Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantInfo.slug },
    create: { id: id(), name: tenantInfo.name, slug: tenantInfo.slug, isActive: true },
    update: { name: tenantInfo.name, isActive: true },
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
  const superAdminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Super Admin' } },
    create: {
      id: id(),
      tenantId: tenant.id,
      name: 'Super Admin',
      description: params.superAdminTplDescription,
      isSystem: true,
    },
    update: { description: params.superAdminTplDescription, isSystem: true },
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
  const permIdByCode = new Map(allPermissions.map((p) => [p.code, p.id]));

  const allTemplates = await prisma.systemRoleTemplate.findMany();
  const tplIdByName = new Map(allTemplates.map((t) => [t.name, t.id]));

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

    await seedDevTenant({
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

    await seedDevTenant({
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
    console.log(`    - acme  (manager@acme.local / Manager123!)`);
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
