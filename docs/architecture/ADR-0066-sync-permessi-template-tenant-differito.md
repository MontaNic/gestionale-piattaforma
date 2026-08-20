# ADR-0066 — Sync permessi template→tenant: differito con trigger esplicito

**Status:** Accepted
**Date:** 2026-07-01
**Related:** ADR-0005 (bootstrap tenant), ADR-0060 (sync no-op — prima misura), ADR-0063 (tiering STOP-gate)

## Context

Il "problema sistemico permessi" noto: il bootstrap tenant (ADR-0005) clona i `system_role_templates` **one-shot** alla nascita del tenant; i permessi aggiunti ai template dopo non propagano retroattivamente ai tenant esistenti. Il resync vive solo nel seed, additivo/idempotente, limitato ai tenant well-known hardcoded.

Ri-misura empirica read-only su **prod**, 2026-07-01 (STOP 0), per stabilire se esiste un consumer reale prima di costruire il meccanismo di sync.

## Evidenza (prod, 2026-07-01)

**Delta = 0.** Su 6 ruoli materializzati / 4 tenant well-known (`demo`, `acme`, `studio-demo`, `oneplatform`), ogni ruolo coincide col rispettivo template al permesso: 0 mancanti, 0 in eccesso, 0 ruoli senza template. Foto identica ad ADR-0060.

Ancore: 60 permessi · 11 template (`isDefault`) · 249 template-perms · 6 ruoli · 245 role-perms.

**Nessun consumer futuro lasciato indietro.** I permessi food orfani (`comande.*` ×5, `cassa.*` ×4, `magazzino.*` ×2, feature non ancora implementata) sono **già** in tutti i Super Admin (in 4/4 tenant). I ruoli operativi food che li userebbero (Cameriere, Cassiere, Cucina/Bar, Direzione, Socio, Admin sede) hanno **0 istanze materializzate** in qualsiasi tenant → quando il blocco restaurant li cablerà, nasceranno **freschi copiando il template di allora**. Non esiste popolazione preesistente da aggiornare retroattivamente: in questo scenario il bootstrap one-shot è corretto, non fragile.

**Meccanismo confermato:** clone one-shot in `tenants.service.ts` (creazione tenant, copia integrale dei template `isDefault`); nessun re-sync a runtime; resync seed solo per i 4 well-known. Nessun tenant creato via API esiste oggi.

## Decision

**Il meccanismo di sync template→tenant è DIFFERITO.** Costruirlo ora sarebbe costruire senza consumer (YAGNI / Pattern 43): delta reale nullo e nessun ruolo esistente a rischio di rimanere indietro.

**Trigger esplicito per riattivare il lavoro:** la nascita del **primo tenant creato via API** (non well-known, quindi fuori dal resync del seed). Solo allora un cambiamento successivo ai template potrebbe lasciare quel tenant disallineato, creando il consumer reale.
Nota: "aggiungere permessi ai template" **non** è il trigger — i ruoli materializzati dopo la modifica li ereditano automaticamente dal bootstrap; solo i ruoli **preesistenti** di un tenant non-resynced sono a rischio.

Il trigger si colloca plausibilmente insieme all'API pubblica per-tenant (post-livello-2, memoria roadmap).

## Consequences

- La voce "problema sistemico permessi (aperto)" si **chiude** → "monitorato, trigger definito". Non è rumore aperto: è una condizione verificabile in attesa.
- Quando il trigger comparirà, il fix sarà **tier alto** (scrittura cross-tenant su `role_permissions` di tenant in prod, path superuser/DIRECT_URL analogo a purge-tenant) e richiederà STOP-gate pieno.
- Nessun codice/schema/test modificato: puro triage documentale, come ADR-0065.
- Resta tracciato il `TD-role-template-key` (ADR-0060): il join template↔ruolo è per `name` stringa, unico match esistente; rilevante quando/se si costruirà il sync.

---

## Amendment 2026-08-20 — il debito è meccanizzato (`TD-deploy-perm-reconcile-gate`)

L'ADR differiva il **meccanismo di sync**. Questo amendment non lo costruisce: costruisce il
**rilevamento**, che è cosa diversa e ha un consumer che l'ADR non aveva previsto.

### Cosa l'ADR aveva sbagliato a inquadrare

Il trigger dichiarato — «la nascita del primo tenant creato via API» — non si è mai verificato, e
nel frattempo il debito **ha morso tre volte**: S19 (`notespese.*` mai arrivati ai ruoli), S20
(`cassa.pagamento.registra`, con conti non chiudibili come conseguenza reale), S21 (il `Direzione`
di Studio Ferretti senza `report.operativo.visualizza`, trovato di lato).

La nota «"aggiungere permessi ai template" **non** è il trigger» è **errata come scritta**. Vale
solo per i ruoli materializzati _dopo_ la modifica. Per i ruoli **già esistenti** — cioè tutti
quelli in produzione — aggiungere un permesso a un template è esattamente il trigger, anche nei
tenant well-known: il resync del seed vive dentro `if (allowsDevData(SEED_NODE_ENV))`
(`prisma/seed.ts`), quindi con `NODE_ENV=production` **non gira affatto**. Il seed di produzione non
ha alcun codice che scriva `role_permissions`.

Il trigger reale è: **qualsiasi permesso aggiunto a un template i cui ruoli sono già materializzati.**

### Decisione

Il controllo template↔DB, finora prosa nel runbook e memoria dell'operatore, diventa lo script
`packages/db/scripts/check-role-permissions-drift.ts` (`pnpm --filter @gestionale/db
check:role-perms`), eseguito **due volte** in finestra di deploy — pre-build e post-deploy.

Il catalogo RBAC (`PERMISSIONS`, `ROLE_TEMPLATES`) è estratto da `prisma/seed.ts` a
`prisma/rbac-catalog.ts` — move puro, contenuto invariato. Serviva perché `seed.ts` esegue il seed
al top-level: importarlo per leggerne il catalogo lo farebbe girare. Il gate importa il set atteso
invece di hardcodarlo.

### Confine di copertura

Il gate riconcilia i ruoli con `deleted_at IS NULL`, `is_system = true` e nome presente in
`ROLE_TEMPLATES`. Il legame ruolo↔template resta **per nome** (`TD-role-template-key`, ADR-0060):
`roles` non ha colonna `template_id`. I ruoli fuori da questo confine non sono silenziati —
sono elencati come non riconciliabili (C4) e bloccano.

### Condizione di validità — da rileggere se cambia

Il gate è **bloccante** perché oggi i permessi di ruolo **non sono editabili dall'app**: non esiste
controller/service di gestione ruoli in `apps/`, e `sistema.ruolo.crea` / `sistema.ruolo.assegna`
hanno zero consumer. Sotto questa condizione «diverso dal template» **implica** «sbagliato».

Se nasce una UI di gestione ruoli, la condizione cade: una divergenza diventerebbe legittima e C2/C3
direbbero il falso. Vanno ripensati **prima** che quella UI esista, non dopo.

### Cosa resta differito

Il **sync automatico** template→ruoli. Il gate rileva e propone il comando; la scrittura resta
un'azione manuale con il suo STOP, coerente con «tier alto» già scritto nelle Consequences.
