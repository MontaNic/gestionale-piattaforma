// =============================================================================
// check-role-permissions-drift.ts — GATE deriva `role_permissions` ↔ template
// =============================================================================
// Meccanizza il controllo che finora dipendeva dalla memoria dell'operatore.
// Ha morso TRE volte, sempre allo stesso modo:
//
//   S19 (2026-07-23, notespese) — `db:seed:prod` porta permissions 60→63 e i
//     mapping template 249→262, ma `role_permissions` resta 245: nessun ruolo
//     riceve i `notespese.*`, UI Note Spese invisibile a tutti.
//   S20 (2026-07-27, cassa) — stesso schema con `cassa.pagamento.registra`.
//     NON cosmetico: con la guardia D3 live un conto con totale > 0 diventa
//     non chiudibile (pagamento 403 + `chiudi` 409), unica uscita `annulla`.
//     Non c'è bypass super-admin nell'RBAC: PermissionsGuard fa lookup esplicito.
//   S21 (2026-07-28, ADR-0084 §D2) — il ruolo `Direzione` di Studio Ferretti
//     senza `report.operativo.visualizza` pur avendolo il template omonimo.
//     Trovato DI LATO, per fortuna, mentre si verificava altro.
//
// CAUSA, alla riga: `prisma/seed.ts` avvolge tutte le sue scritture su
// `role_permissions` in `if (allowsDevData(SEED_NODE_ENV))`. Con
// NODE_ENV=production il ramo è saltato per intero → il seed di produzione non
// ha ALCUN codice che scriva `role_permissions`, nemmeno per riconciliare.
// Un permesso nuovo raggiunge `permissions` e i template, mai i ruoli già
// materializzati. L'unico altro scrittore è il bootstrap tenant
// (`packages/auth/src/tenants/tenants.service.ts`), che gira solo alla nascita
// del tenant.
//
// ⚠️ IL GATE È BLOCCANTE PERCHÉ OGGI I PERMESSI DI RUOLO NON SONO EDITABILI
// DALL'APP. Verificato: nessun controller/service di gestione ruoli in `apps/`;
// `sistema.ruolo.crea` e `sistema.ruolo.assegna` esistono nel catalogo ma hanno
// zero consumer. Quindi «diverso dal template» IMPLICA «sbagliato».
// Se nasce una UI di gestione ruoli, C2 e C3 perdono questa proprietà e vanno
// ripensati: una divergenza diventerebbe legittima e il gate direbbe il falso.
//
// Il set atteso è importato da `../prisma/rbac-catalog` — non hardcodato. Un
// gate con i totali scritti a mano (64 permessi / 267 mapping) andrebbe
// aggiornato ad ogni feature con permessi nuovi, cioè fallirebbe esattamente
// come ciò che deve prevenire.
//
// Uso (da packages/db/):
//   pnpm check:role-perms        # DB di PRODUZIONE (127.0.0.1:5432/gestionale)
//   pnpm check:role-perms:dev    # DB dev isolato   (127.0.0.1:55432/gestionale)
//
// Read-only: nessuna scrittura, in nessun ramo. Va eseguito DUE volte in
// finestra di deploy — pre-build e post-deploy — con lo stesso esito
// (docs/runbook-deploy-infrastrutturale.md, GATE permessi).
//
// Exit: 0 = nessuna deriva; 1 = deriva rilevata (o zero ruoli esaminati);
//       2 = errore inatteso / connessione.
// =============================================================================

import { PrismaClient } from '@prisma/client';

import { assertSafeDbTarget } from '../src/assert-safe-db-target';
import { PERMISSIONS, ROLE_TEMPLATES } from '../prisma/rbac-catalog';

// ─────────────────────────────────────────────────────────────────────────────
// Tipi delle righe lette (tutto via $queryRawUnsafe: nessun modello Prisma qui,
// perché il gate deve poter girare anche se il client è disallineato al DB).
// ─────────────────────────────────────────────────────────────────────────────
interface RoleRow {
  slug: string;
  role_id: string;
  role_name: string;
  is_system: boolean;
}
interface RolePermRow {
  role_id: string;
  code: string;
}
interface TplPermRow {
  template_name: string;
  code: string;
}

/** Una deriva riportabile: la tripla che serve all'operatore per agire. */
interface Finding {
  tenant: string;
  role: string;
  code: string;
}

/** Esito di un singolo check. `blocking: false` = informativo (giallo). */
interface CheckResult {
  id: string;
  title: string;
  blocking: boolean;
  problems: string[];
}

/**
 * Target leggibile a partire dalla connection string, SENZA credenziali.
 * Stampato ad ogni run (D3): sullo stesso host convivono il Postgres di
 * produzione (:5432) e quello di dev (:55432), e un gate che non dice su quale
 * ha girato è un gate di cui non ti puoi fidare.
 */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    const port = u.port === '' ? '5432' : u.port;
    const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
    return `${u.hostname}:${port}/${db}`;
  } catch {
    return '(connection string non parsabile)';
  }
}

/**
 * Container Postgres corrispondente al target, per il comando di rimedio.
 * NON hardcodare `gestionale_postgres`: sullo stesso host convivono prod
 * (:5432) e dev (:55432), e un rimedio stampato dopo un run su dev che punta a
 * prod è un copia-incolla che scrive dove non deve. Se la porta non è una delle
 * due note, si rifiuta di indovinare.
 */
function remedyTarget(url: string): { container: string; db: string } | null {
  try {
    const u = new URL(url);
    const port = u.port === '' ? '5432' : u.port;
    const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (port === '5432') return { container: 'gestionale_postgres', db };
    if (port === '55432') return { container: 'gestionale_postgres_dev', db };
    return null;
  } catch {
    return null;
  }
}

/** Elementi di `a` assenti da `b`. */
function missingFrom(a: Iterable<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

/** Formatta le derive come `tenant / ruolo / codice`, una per riga. */
function formatFindings(fs: Finding[]): string[] {
  const wT = Math.max(...fs.map((f) => f.tenant.length));
  const wR = Math.max(...fs.map((f) => f.role.length));
  return fs.map((f) => `${f.tenant.padEnd(wT)} / ${f.role.padEnd(wR)} / ${f.code}`);
}

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('❌ DIRECT_URL assente. Esegui via: pnpm check:role-perms (carica ../../.env)');
    return 2;
  }

  // Guard anti-prod-da-host: il client non passa dalla factory `createPrismaClient`,
  // quindi il guard va richiamato qui sull'url effettivo. Il gate DEVE poter
  // girare su prod (è il suo scopo) → il wrapper npm lo lancia con
  // ALLOW_PROD_DB_ACCESS=1; lanciato "nudo" contro prod aborta.
  assertSafeDbTarget(url, {
    nodeEnv: process.env.NODE_ENV,
    allowProdDb: process.env.ALLOW_PROD_DB_ACCESS === '1',
  });

  const target = describeTarget(url);
  // Ogni comando suggerito segue il TARGET, mai un default hardcodato: sullo
  // stesso host convivono prod (:5432) e dev (:55432), e un suggerimento
  // stampato dopo un run su dev che punta a prod è un copia-incolla che scrive
  // dove non deve. Vale per il seed qui e per il container in `remedyTarget`.
  const seedCmd =
    remedyTarget(url)?.container === 'gestionale_postgres_dev'
      ? 'pnpm --filter @gestionale/db devdb:seed'
      : 'pnpm --filter @gestionale/db db:seed:prod';

  console.log('=== GATE deriva role_permissions ↔ template ===');
  console.log(`Target: ${target}   (read-only)\n`);

  // Superuser (DIRECT_URL), RLS bypassata; nessuna estensione RLS applicata.
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Lettura: UNA sola transazione interattiva = UNA sola connessione.
    // `SET LOCAL app.is_super_admin` come prima istruzione (D5): con il pooling
    // di Prisma un `SET` fuori transazione può finire su una connessione diversa
    // da quella delle query → `roles` è RLS FORCED, il result set tornerebbe
    // VUOTO e un gate ingenuo direbbe "nessuna deriva". Vedi anche il controllo
    // D4 sul numero di ruoli esaminati, in fondo.
    // ─────────────────────────────────────────────────────────────────────────
    const snapshot = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.is_super_admin = 'true'`);

      const dbPermissions = await tx.$queryRawUnsafe<Array<{ code: string }>>(
        `SELECT code FROM permissions`,
      );
      const dbTemplates = await tx.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM system_role_templates`,
      );
      const dbTplPerms = await tx.$queryRawUnsafe<TplPermRow[]>(
        `SELECT srt.name AS template_name, p.code AS code
           FROM system_role_template_permissions srtp
           JOIN system_role_templates srt ON srt.id = srtp.template_id
           JOIN permissions p ON p.id = srtp.permission_id`,
      );
      // Soft-deleted esclusi: `roles_tenant_name_active_uq` è un unique PARZIALE
      // (WHERE deleted_at IS NULL), quindi un ruolo cancellato può coesistere
      // con l'omonimo vivo e il match per nome li conterebbe entrambi.
      const dbRoles = await tx.$queryRawUnsafe<RoleRow[]>(
        `SELECT t.slug AS slug, r.id AS role_id, r.name AS role_name, r.is_system AS is_system
           FROM roles r
           JOIN tenants t ON t.id = r.tenant_id
          WHERE r.deleted_at IS NULL`,
      );
      const dbRolePerms = await tx.$queryRawUnsafe<RolePermRow[]>(
        `SELECT rp.role_id AS role_id, p.code AS code
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           JOIN roles r ON r.id = rp.role_id
          WHERE r.deleted_at IS NULL`,
      );
      return { dbPermissions, dbTemplates, dbTplPerms, dbRoles, dbRolePerms };
    });

    const results: CheckResult[] = [];

    // ─────────────────────────────────────────────────────────────────────────
    // C1 — Catalogo DB vs codice.
    // Senza questo check il gate ha un falso verde ESATTAMENTE nella finestra in
    // cui serve: fra il rollout e `db:seed:prod` il template non contiene ancora
    // il permesso nuovo, quindi il confronto ruolo↔template è verde e privo di
    // significato.
    // ─────────────────────────────────────────────────────────────────────────
    const codePermCodes = new Set(PERMISSIONS.map((p) => p.code));
    const dbPermCodes = new Set(snapshot.dbPermissions.map((r) => r.code));
    const codeTplNames = new Set(ROLE_TEMPLATES.map((t) => t.name));
    const dbTplNames = new Set(snapshot.dbTemplates.map((r) => r.name));

    // Mapping template↔permesso confrontati come mappe annidate, NON come chiavi
    // stringa concatenate: i nomi dei template contengono spazi ("Super Admin",
    // "Admin sede"), quindi qualunque separatore stampabile sarebbe ambiguo.
    // Nidificare toglie il problema invece di doverne scegliere uno.
    const codeTplMap = new Map(ROLE_TEMPLATES.map((t) => [t.name, new Set(t.permissionCodes)]));
    const dbTplMap = new Map<string, Set<string>>();
    for (const r of snapshot.dbTplPerms) {
      const s = dbTplMap.get(r.template_name) ?? new Set<string>();
      s.add(r.code);
      dbTplMap.set(r.template_name, s);
    }
    /** Mapping presenti in `a` e assenti da `b`, resi come `Template → codice`. */
    const tplMapDiff = (a: Map<string, Set<string>>, b: Map<string, Set<string>>): string[] =>
      [...a]
        .flatMap(([name, codes]) =>
          missingFrom(codes, b.get(name) ?? new Set<string>()).map((c) => `${name} → ${c}`),
        )
        .sort();
    const codeTplPairCount = ROLE_TEMPLATES.reduce((n, t) => n + t.permissionCodes.length, 0);

    const c1: string[] = [];
    const permMissing = missingFrom(codePermCodes, dbPermCodes);
    const tplMissing = missingFrom(codeTplNames, dbTplNames);
    const tplPairMissing = tplMapDiff(codeTplMap, dbTplMap);
    if (permMissing.length > 0) {
      c1.push(
        `permessi nel codice ASSENTI dal DB (${permMissing.length}): ${permMissing.join(', ')}`,
      );
    }
    if (tplMissing.length > 0) {
      c1.push(
        `template nel codice ASSENTI dal DB (${tplMissing.length}): ${tplMissing.join(', ')}`,
      );
    }
    if (tplPairMissing.length > 0) {
      c1.push(
        `mapping template ASSENTI dal DB (${tplPairMissing.length}): ${tplPairMissing.join(', ')}`,
      );
    }
    if (c1.length > 0) {
      c1.push(`→ il seed non è ancora girato su questo DB: \`${seedCmd}\``);
    }
    results.push({
      id: 'C1',
      title: 'catalogo DB allineato al codice (permessi + template + mapping)',
      blocking: true,
      problems: c1,
    });

    // C1-bis — eccessi nel catalogo: informativo, non bloccante. Il seed non
    // ripulisce ciò che è stato rimosso dal codice (né `permissions` né
    // `system_role_template_permissions`) → è un debito noto e a sé,
    // `TD-seed-non-ripulisce-rimossi`, non una deriva dei ruoli.
    const c1b: string[] = [];
    const permExtra = missingFrom(dbPermCodes, codePermCodes);
    const tplPairExtra = tplMapDiff(dbTplMap, codeTplMap);
    if (permExtra.length > 0) {
      c1b.push(`permessi nel DB ASSENTI dal codice (${permExtra.length}): ${permExtra.join(', ')}`);
    }
    if (tplPairExtra.length > 0) {
      c1b.push(
        `mapping template nel DB ASSENTI dal codice (${tplPairExtra.length}): ${tplPairExtra.join(', ')}`,
      );
    }
    results.push({
      id: 'C1-bis',
      title: 'residui nel catalogo DB rimossi dal codice (informativo)',
      blocking: false,
      problems: c1b,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // C2/C3 — ruoli materializzati vs template, nei due versi.
    // Confine di copertura: `deleted_at IS NULL` + `is_system = true` + nome
    // presente in ROLE_TEMPLATES. Il legame ruolo↔template è per NOME: la
    // tabella `roles` non ha alcuna colonna `template_id`.
    // Il confronto è contro il CODICE (ROLE_TEMPLATES), non contro i template in
    // DB: così C2 resta significativo anche quando C1 è rosso.
    // ─────────────────────────────────────────────────────────────────────────
    const permsByRole = new Map<string, Set<string>>();
    for (const rp of snapshot.dbRolePerms) {
      const s = permsByRole.get(rp.role_id) ?? new Set<string>();
      s.add(rp.code);
      permsByRole.set(rp.role_id, s);
    }
    const tplByName = new Map(ROLE_TEMPLATES.map((t) => [t.name, new Set(t.permissionCodes)]));

    const inScope = snapshot.dbRoles.filter((r) => r.is_system && tplByName.has(r.role_name));
    const outOfScope = snapshot.dbRoles.filter((r) => !r.is_system || !tplByName.has(r.role_name));

    const c2: Finding[] = [];
    const c3: Finding[] = [];
    for (const r of inScope) {
      const expected = tplByName.get(r.role_name) ?? new Set<string>();
      const actual = permsByRole.get(r.role_id) ?? new Set<string>();
      for (const code of missingFrom(expected, actual)) {
        c2.push({ tenant: r.slug, role: r.role_name, code });
      }
      for (const code of missingFrom(actual, expected)) {
        c3.push({ tenant: r.slug, role: r.role_name, code });
      }
    }

    results.push({
      id: 'C2',
      title: `permessi del template MANCANTI ai ruoli materializzati (${inScope.length} ruoli esaminati)`,
      blocking: true,
      problems: c2.length > 0 ? formatFindings(c2) : [],
    });
    results.push({
      id: 'C3',
      title: 'permessi dei ruoli IN ECCESSO rispetto al template',
      blocking: true,
      problems: c3.length > 0 ? formatFindings(c3) : [],
    });

    // ─────────────────────────────────────────────────────────────────────────
    // C4 — ruoli fuori dal confine di copertura. ELENCATI, non silenziati:
    // se S21 fosse nato in prod invece che in dev, silenziarli sarebbe stato il
    // modo in cui sarebbe sfuggito anche a questo gate.
    // ─────────────────────────────────────────────────────────────────────────
    const c4 = outOfScope.map((r) => {
      const why = !tplByName.has(r.role_name)
        ? 'nessun template omonimo nel codice'
        : 'is_system = false (creato a mano, non clonato da template)';
      return `${r.slug} / ${r.role_name}  —  ${why}`;
    });
    results.push({
      id: 'C4',
      title: 'ruoli NON riconciliabili (fuori dal confine di copertura)',
      blocking: true,
      problems: c4,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Report — tutti i check eseguiti e riportati, non solo il primo rosso.
    // ─────────────────────────────────────────────────────────────────────────
    let failed = false;
    for (const r of results) {
      if (r.problems.length === 0) {
        console.log(`✅ ${r.id} — ${r.title}`);
        continue;
      }
      const mark = r.blocking ? '❌' : '🟡';
      if (r.blocking) failed = true;
      const out = r.blocking ? console.error : console.log;
      out(`${mark} ${r.id} — ${r.title}`);
      for (const p of r.problems) out(`     ${p}`);
    }

    // D4 — "zero ruoli esaminati" è ROSSO, non verde. È il falso verde classico:
    // eseguito senza `SET app.is_super_admin` (o come ruolo non privilegiato) il
    // result set su `roles` sarebbe vuoto e ogni check sopra passerebbe a vuoto.
    if (inScope.length === 0) {
      failed = true;
      console.error('❌ D4 — ZERO ruoli esaminati: il gate non ha verificato nulla.');
      console.error(
        '     Cause tipiche: RLS FORCE su `roles` senza `SET app.is_super_admin` sulla stessa',
      );
      console.error(
        '     connessione (DATABASE_URL = ruolo app invece di DIRECT_URL = superuser), oppure DB vuoto.',
      );
      console.error('     Un result set vuoto NON è "nessuna deriva".');
    }

    if (!failed) {
      console.log(
        `\n✅ GATE VERDE — ${target}: ${inScope.length} ruoli materializzati su ${snapshot.dbRoles.length} totali`,
      );
      console.log(
        `   coincidono ESATTAMENTE con gli ${ROLE_TEMPLATES.length} template di prisma/rbac-catalog.ts`,
      );
      console.log(
        `   (${PERMISSIONS.length} permessi, ${codeTplPairCount} mapping template) — nessun mancante, nessun eccesso.`,
      );
      return 0;
    }

    // Rimedio pronto da copiare. L'ordine conta: se C1 è rosso, riconciliare
    // PRIMA del seed non inserirebbe nulla (il template non ha ancora il mapping).
    // L'header si stampa solo se c'è davvero qualcosa da suggerire: un rosso da
    // solo D4 non ha rimedio SQL — va corretto il modo in cui il gate è invocato.
    if (c1.length > 0 || c2.length > 0 || c3.length > 0 || c4.length > 0) {
      console.error('\n─── RIMEDIO ───');
    }
    if (c1.length > 0) {
      console.error('1) PRIMA il seed (i template in DB non sono allineati al codice):');
      console.error(`   ${seedCmd}`);
      console.error('2) POI la riconciliazione qui sotto.');
    }
    if (c2.length > 0) {
      console.error(
        `Riconciliazione idempotente per ${target} (guidata dal template ri-affermato dal seed,`,
      );
      console.error('non da una lista di codici scritta a mano):');
      const rt = remedyTarget(url);
      if (rt === null) {
        console.error(
          `   ⚠️ target ${target} non riconosciuto (né prod :5432 né dev :55432): il comando`,
        );
        console.error(
          '   non viene stampato per non suggerire il container sbagliato. Componilo tu sul target giusto.',
        );
      } else {
        console.error(`
docker exec -i ${rt.container} psql -U postgres -d ${rt.db} -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL app.is_super_admin = 'true';
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN system_role_templates srt ON srt.name = r.name
JOIN system_role_template_permissions srtp ON srtp.template_id = srt.id
JOIN permissions p ON p.id = srtp.permission_id
LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_id = p.id
WHERE r.deleted_at IS NULL AND r.is_system = true AND rp.permission_id IS NULL
ON CONFLICT DO NOTHING;
COMMIT;
SQL`);
      }
      console.error(
        '   Poi ri-esegui questo gate: deve tornare verde. Registra le coppie inserite nel report.',
      );
    }
    if (c3.length > 0) {
      console.error(
        'C3 (eccessi) NON si risolve automaticamente: un permesso fuori template è un privilegio',
      );
      console.error(
        '   non previsto. Capisci da dove viene PRIMA di rimuoverlo — potrebbe essere una feature.',
      );
    }
    if (c4.length > 0) {
      console.error(
        'C4: ruoli fuori confine. O rientrano (aggiungi il template a prisma/rbac-catalog.ts e',
      );
      console.error(
        '   allinea `is_system`), o la loro esistenza è una decisione da prendere, non da ignorare.',
      );
    }
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('\n❌ check-role-permissions-drift errore inatteso:', err);
    process.exit(2);
  });
