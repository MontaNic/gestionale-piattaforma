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
