# ADR-0074 — Note Spese v1 PR-1 (schema + fondamenta)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [spec consolidata](../spec/note-spese-v1.md), [ADR-0009](./ADR-0009-rls-real.md) (RLS), [ADR-0071](./ADR-0071-ci-e2e-testcontainers-be-non-gated.md) (gate RLS accountant, PR-0)

## Context

Prima feature del blocco Note Spese (verticale accountant/StudioDesk). Migrazione su **schema Prisma unico condiviso** — un solo DB `gestionale` serve prod live di accountant _e_ restaurant. La spec viveva solo in chat (STOP 1 rev.2): persistita in [`docs/spec/note-spese-v1.md`](../spec/note-spese-v1.md) come Commit 0. PR-1 = **solo fondamenta** (schema + migrazione + permessi + gate RLS); nessun service/endpoint/FE (PR successive).

**Ri-validazione (STOP 0)**: la spec regge; unico aggiustamento sostanziale = il gate RLS DB-level, oggi esteso all'accountant (PR-0). PR-1 nasce il suo spec di isolamento **dentro** quel gate.

## Decisions applicate (delta rev.2 D1-D7)

- **D1 — id app-side**: `id String @id` senza `@default` su entrambi i modelli → `id: id()` (uuidv7) nel service (PR-2), come `documenti`/`mandati`.
- **D2 — `@@map` plurale**: `note_spese` / `note_spese_allegati` (la base spec diceva singolare: superato).
- **D3 — enum suffissati**: `StatoNotaSpesa`, `MetodoPagamentoNotaSpesa`, `AliquotaIvaNotaSpesa`, `TipoAllegatoNotaSpesa`; `TipoSpesa`/`DeducibilitaFiscale` nudi (nessuna collisione, verificato).
- **D5 — hard-delete (nessun `deletedAt`)**: divergenza **intenzionale**. `DELETE` consentito solo in stato `bozza` (nessun valore probatorio/fiscale); note `inviata`/`approvata`/`respinta` non eliminabili per state machine → nessun record fiscale distrutto; l'allegato **deve** essere hard-deleted (un `deletedAt` lascerebbe l'oggetto orfano in storage). `soft-delete.ts` auto-rileva via DMMF i model con `deletedAt`: l'assenza è safe, nessun intercept. Aggiungere `deletedAt` in futuro è additivo (tier BASSO).
- **D7 — back-relations additive** su `User` (autore + approvatore, relazioni named), `Azienda`, `Mandato`. **`User` è shared cross-verticale** → relazione inversa pura, nessuna colonna nuova, nessuna ALTER.

## Migrazione (additivo puro)

`20260723163039_add_note_spese`: 6 CREATE TYPE + 2 CREATE TABLE + 4 index + 6 FK (tutte `ALTER TABLE "note_spese*"` sulle tabelle NUOVE). **DDL ispezionato: zero ALTER su tabelle esistenti** (users/aziende/mandati/tenants solo referenziate). RLS aggiunta a mano (Prisma non la genera), **template corrente**: `tenant_id TEXT`, super-admin bypass OR tenant_id match (text-to-text, no `::uuid`), **USING-only**, **FORCE** su entrambe. **Nessun GRANT esplicito**: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` copre le nuove tabelle (verificato: le migration domain recenti hanno 0 GRANT). Applicata su dev env Sub-B (55432); `pg_policies` + `relforcerowsecurity=t` verificati. **Mai su prod.**

**Pattern 42**: `@@unique([notaSpesaId, tipo])` è additivo su tabella nuova, nessun dato preesistente → **nessun duplicate-check operativo necessario** (confermato).

## Permessi (60 → 63)

3 permessi `notespese.*` (`gestisci`/`leggi_tutte`/`approva`, categoria `notespese`) nell'array `PERMISSIONS`. Non `isPortale` → `ALL_PERMISSION_CODES` → admin-tier (Super Admin/Admin/Socio) li ricevono automaticamente. PIN verificato: **63 = PERMISSIONS.length**, **59 = Super Admin (63 − 4 portale)**. **Assegnazione a ruoli NON-admin: non nella spec recuperata → NON decisa** (editato solo l'array; nessun role template toccato). Da sciogliere prima o durante PR-2.

## Gate RLS (requisito nuovo da PR-0)

`note-spese-rls-isolation.e2e-spec.ts` aggiunto al selettore `test:e2e:rls` accountant (N=1 → **N=2**, verificato). **Solo raw-query DB-level** come `gestionale_app` (nessun HTTP: PR-1 non ha service, e la discovery PR-0 mostra che i test HTTP restano verdi anche con RLS bypassata per via del filtro app). Copertura: lettura (S1/S2) + scrittura (S3/S4, INSERT cross-tenant respinto) su entrambe le tabelle. **Prova di efficacia** (vettore = policy): rotta la policy `note_spese` → S1 (READ leak) + S3 (WRITE non respinto) rossi → ripristino verde.

## Regole per PR-2 (registrate, non implementate)

- **D6** — coerenza `aziendaId`↔`mandatoId`: se `mandatoId` valorizzato → `aziendaId` obbligatorio e = `mandato.aziendaId`, altrimenti `E_NOTASPESA_MANDATO_AZIENDA_MISMATCH`. Non FK-enforceable → validazione nel service (create + update). Analogo esistente: `documenti.assertAzienda`, `prestazioni` che carica il mandato tenant-scoped.
- **D4** — `distanzaKm` soft-warning FE, nessuna validazione BE.
- Altre regole §4 (giustificativo se totale>0; scontrino se metodo ∈ carta\_\*) + API/service/DTO + 14 test: **da recuperare da `MT_Accountant_S18` prima di PR-2.**

## Deferral (trigger-gated)

- **Client Portal / visibilità cliente-esterno** — trigger: primo cliente che chiede accesso, o decisione orchestratore. Costo BASSO (pattern `portale-*`: `assertCliente` + `portale.*` + scoping app-layer). Nessun redesign auth/RLS.
- **OCR / RAG** — trigger: provider vision (GroqService è text-only).
- Multi-valuta, workflow multi-livello, export contabile, `File` model condiviso: fuori scope v1.

## Consequences

- **Positive**: fondamenta Note Spese in prod-schema in modo additivo puro; isolamento RLS gatato in CI da subito (non nasce fuori dal gate). Cross-verticale non impattato (nessuna ALTER su tabelle restaurant/accountant esistenti).
- **Costi/rischi**: hard-delete richiede disciplina applicativa (delete solo in bozza) — enforced nel service (PR-2). PR-2 bloccata finché §4-§7 non recuperate.
