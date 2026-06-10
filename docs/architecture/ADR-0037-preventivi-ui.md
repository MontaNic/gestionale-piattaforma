# ADR-0037 — Preventivi UI (lista detail + editor voci con totali mirror)

- **Status:** Accepted
- **Date:** 2026-06-10
- **Relates:** ADR-0036 (preventivi backend), ADR-0034 (referenti UI / pattern sezione detail), ADR-0032 (aziende UI), ADR-0030 (accountant-web skeleton)

## Context

UI del backend preventivi (ADR-0036). Backend nested `aziende/:aziendaId/preventivi`.
Primo editor con array di righe dinamiche + business logic visibile a schermo nel verticale.

## Decisions

**DP-aggancio = C (ibrido route):** lista preventivi come sezione sotto `clienti/[id]`
(pattern ReferentiSection); editor su route annidata
`clienti/[id]/preventivi/[preventivoId]` + `/nuovo`. Nessuna voce nav nuova.
Alternative scartate: A (tutto inline nel detail — editor troppo grosso per una sezione),
B (route top-level — richiede selettore azienda ridondante col nested backend).

**DP-editor-voci = ibrido:** testata in RHF+zod (codice/oggetto/stato/validoFino/
coverLetter/noteInterne); voci in `useState` dedicato + `useMemo(computeTotali)`.
Numerici come stringa nel form, `Number()` al submit (Discovery S19 — z.coerce.number
rompe inferenza zodResolver). Alternativa scartata: useFieldArray (watch() su array
annidato per totali live è più fragile del useMemo su useState separato).

**Mirror totali (invariante):** `lib/preventivi-totali.ts` replica byte-esatta della
formula server (ADR-0036 §computeVoce/computeTotali). Ordine vincolante:
round(qta·prezzo·(1−sconto%), 2) = imponibile voce; IVA = round(imponibile·aliquota%, 2)
per-voce; somma imponibili e IVA, poi round aggregati; totale = round(imp+iva, 2).
Cross-checkato a mano contro il service: 3 casi divergenti dove round-per-voce ≠
round-aggregato (caso 1: 0.06 ≠ 0.07).

**Wire normalizzazione:** Prisma serializza Decimal come stringa JSON e `validoFino`
come ISO datetime completo. Normalizzazione nel layer `preventivi-api.ts`
(Decimal→Number, validoFino→YYYY-MM-DD via .slice(0,10)) — i domain types restano
onesti, i componenti non fanno conversioni difensive. Trovato da verifica runtime
(p.totale.toFixed is not a function).

## File

Nuovi: lib/preventivi-{types,api,totali}.ts + preventivi-totali.test.ts +
components/preventivi/{PreventiviSection,VociEditor,PreventivoForm}.tsx +
route preventivi/nuovo + preventivi/[preventivoId] + apps/accountant-web/vitest.config.ts

Modificati: clienti/[id]/page.tsx + error-codes.ts + i18n/{it,en}.json +
packages/db/prisma/seed.ts + root vitest.config.mts (+1 riga)

## Tech debt

- **TD candidate — seed utente non-superuser studio-demo:** gating
  `preventivi.visualizza/gestisci` verificato solo a livello codice, non runtime
  (admin@studio.local è Super Admin con 35 permessi). Fix: seed di un utente Direzione
  o Admin sede per studio-demo. Bassa priorità, ~20min.
- **TD-RLS-preventivi candidate:** policy `preventivi_tenant_isolation` +
  `preventivi_voci_tenant_isolation` installate (ADR-0036) ma non esercitate da e2e
  (suite superuser, TD-BV) né da `rls-isolation.e2e-spec.ts` (copre solo anagrafica).
  Coerente con TD-RLS-anagrafica pre-ADR-0035. Estensione futura.

## Test

7 unit (mirror formula, 3 casi divergenti cross-checkati contro service).
Verifica runtime Playwright headless: lista/editor/totali live/delete/409 dup codice.
Seed idempotente: 2 run (2 created → 0 created), totali DB == formula mirror.
