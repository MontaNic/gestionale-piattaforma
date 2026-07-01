# HANDOFF — Gestionale Piattaforma

**Ultimo aggiornamento:** 2026-07-01 · fine sessione
**Snapshot:** Main @ `39632ae` (PR #152 merged; +1 commit `docs(handoff)` in arrivo via PR)

---

## PARTE A — Stato

### Deploy (invariato dalla sessione precedente)

- **Accountant** live su `studiodesk.cloud` + `*.studiodesk.cloud` a `0093b79`.
- **Restaurant** live su `food.studiodesk.cloud` (demo/temporaneo; brand finale sarà dominio dedicato).
- Caddy reale bind-mounted da `infra/caddy/conf/Caddyfile`; reload zero-downtime (`caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`), mai restart.
- Schema Prisma **unico** condiviso tra verticali, un solo DB `gestionale`. Il modulo comande esiste **solo a livello codice/DB-schema**: **non ancora deployato** in prod (la migration `add_conto_aggregate` sarà applicata a prod al prossimo deploy restaurant, non è ancora girata su prod).

### PR mergiate in questa sessione (main @ 39632ae)

- **#148** (ADR-0063/0064) — FE-5 drag-persist mappa tavoli coperto da e2e browser-level + utente `direzione@demo.local` (ruolo Direzione) nel seed + tiering STOP-gate formalizzato.
- **#149** (ADR-0065) — triage 3 TD residui accountant → 2 deferred-con-trigger + 1 backlog ops.
- **#150** (ADR-0066) — sync permessi template→tenant differito con trigger esplicito.
- **#151** (ADR-0067) — PR-1 blocco COMANDE: fondamenta dati aggregato `Conto`/`ContoRiga` (migration, RLS FORCE, soft-delete, snapshot pricing).
- **#152** (ADR-0068) — PR-2 blocco COMANDE: operatività BE end-to-end.

### Blocco COMANDE — stato

Backend **completo end-to-end** (PR-1 dati + PR-2 operatività). Su main:

- Aggregato `Conto` → `ContoRiga` (2 livelli; Comanda-KDS differita, sarà additiva via `comandaId` nullable). Conto tenant-scoped (no FK Sede; `sedeId` futuro additivo). RLS FORCE esercitata.
- Modulo `restaurant-api/conti`: endpoint apri/righe(add/patch)/storno/chiudi/annulla. RBAC su 4 `comande.*` (crea=apri, modifica=righe+chiusura/annullo, elimina=storno, visualizza=GET). Audit-in-tx. Soft-delete via service (path ADR-0021). State machine `aperto→{chiuso,annullato}` con blocco mutazioni su stati terminali. Coerenza tavolo↔canale (`cassa⇒tavolo`, `E_CONTO_CHANNEL_TAVOLO_MISMATCH`, 400).
- Modulo `restaurant-api/pricing`: resolver prezzo-per-canale banale (`channel→listino attivo→ArticlePrice ∨ basePrice`) + **fail-fast** `E_PRICE_AMBIGUOUS` (409) su overlap multi-listino. Snapshot congelato (prezzo+nome+reparto) verificato via mutazione SQL raw.
- Manca solo il **FE** (pagina `comande` oggi placeholder) → PR-3.

### Permessi

Catalogo = **60** (invariato in tutta la sessione; PR-1/PR-2 non aggiungono permessi). `comande.stato.cambia` = **orfano intenzionale**, trigger = blocco KDS (documentato ADR-0068, non è dimenticanza).

### Governance/processo

- **ADR-0063 tiering STOP-gate per rischio** in vigore: tier BASSO = un round-trip a `gh pr create`; tier ALTO = STOP-gate pieno. GATE obbligatori in entrambi. In dubbio → alto. Lezione confermata: **modifica al seed condiviso è potenzialmente tier-alto** (coupling smoke/security invisibile allo scope-lock) — emendamento ad ADR-0063 ancora DA FARE (PR docs, non urgente).
- Pattern DB throwaway isolato (porta 55432, volume effimero, `.env` intoccato) per operazioni mutanti quando serve, dato che `.env` dev punta al DB prod (`TD-dev-env-punta-prod`).

### TD / forward tracciati

- `TD-pricing-multilistino` (ADR-0068) — `priority`/finestre validità dormienti; trigger = dati con ≥2 listini attivi per canale.
- `TD-dev-env-punta-prod` — `.env` dev → DB prod, rischio sistemico, fix fuori scope.
- Pattern `TenantTx` (`common/tenant-tx.type.ts`) documentato in ADR-0068 §Nota tecnica — riusabile dai moduli food futuri (extended tx non assegnabile a `Prisma.TransactionClient`).
- TD accountant: `TD-documenti-tipo-codice` + `TD-utente-enum-forward` = **deferred-con-trigger** (ADR-0065); `TD-storage-gc` = backlog ops attivo.
- Problema sistemico permessi = **differito, monitorato** (ADR-0066), trigger = primo tenant via API.

### Nota operativa

Branch locale residuo `docs/adr-0066-sync-permessi-differito` (PR #150 già mergiata, contenuto su main) — cleanup facoltativo: `git branch -D docs/adr-0066-sync-permessi-differito`.

---

## PARTE B — Ripartenza prossima sessione

### Base

Main @ `39632ae`, working tree pulito, nessuna PR aperta, nessun branch feat/pr\* residuo. Verificato empiricamente a fine sessione.

### Entry-point: PR-3 — FE comande

Primo passo = **STOP 0 read-only** della pagina `comande` (oggi `PlaceholderPage`). Poi scope-lock + STOP 1. Tier ALTO ma più contenuto (consuma endpoint BE già esistenti e provati).

- **I CHECK-FE tornano DOVUTI** (erano N/A in PR-1/PR-2): CHECK-FE-1 dark mode, CHECK-FE-2 i18n parity IT↔EN, CHECK-FE-3 no hardcoded IT, CHECK-FE-4 `next build`, CHECK-FE-5 responsive, CHECK-FE-6 a11y.
- Consuma: `POST /conti`, `GET /conti[/:id]`, `POST /conti/:id/righe`, `PATCH .../righe/:id`, `DELETE .../righe/:id`, `POST /conti/:id/chiudi|annulla`.

### Rotta blocco restaurant (fissata 2026-07-01)

**Comande ✅(BE) → PR-3 FE → KDS → Cassa pre-fiscale → RT differito.**

- **KDS**: `comande.stato.cambia` trova qui il consumer; la Comanda diventa aggregato inviabile (additiva su `ContoRiga.comandaId` nullable).
- **Cassa pre-fiscale**: conto/totali/pagamento/chiusura/audit, documento interno, zero omologazione. **RT (Registratore Telematico) = blocco separato e DIFFERITO** — solo con cliente reale che emette scontrini fiscali.
- **AI-pilota food** = blocco dedicato, decision point da sciogliere guardando l'aggregato comande reale (candidati: upselling/note-cucina-NL nelle comande, insight venduto). **Prerequisito:** estrazione `GroqService` da `accountant-api` a `@gestionale/platform` (tier alto), giustificata dal caso scelto, non speculativa.

### Backlog docs (non urgente)

- Emendamento ADR-0063: criterio "seed condiviso → potenzialmente tier-alto".
