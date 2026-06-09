# ADR-0034 — UI `referenti`: detail `clienti/[id]` + sezione referenti

- **Status:** Accepted
- **Date:** 2026-06-09
- **Relates:** ADR-0033 (backend referenti), ADR-0032 (UI aziende), ADR-0019 (detail `menu/[menuId]`, sezione figlia), ADR-0018 (shell/Sidebar)

## Context

STOP-c3b: UI del satellite referenti, consuma il CRUD nested `/api/v1/aziende/:aziendaId/referenti`
(ADR-0033). Introduce il **primo segmento dinamico del verticale accountant** (`clienti/[id]`),
il salto deliberatamente rimandato a STOP-c2 (che aveva scelto form inline senza detail). STOP 0
su anatomia FE reale: `menu/[menuId]/page.tsx` (detail dinamico), `ArticlePricesSection`/
`CategorySection` (sezione figlia), `clienti/page.tsx` + `Sidebar.tsx` (stato post STOP-c2).

## Decisions

### Detail page `clienti/[id]` — primo segmento dinamico del verticale

Client component: `useParams<{ slug, id }>()`, fetch azienda via `getAzienda(id)` (aggiunto a
`aziende-api`, era stato rimosso come dead-code a STOP-c2). Header azienda **read-only** (scheda:
nome, codice, tipo, badge stato + `<dl>` dei campi di contatto popolati, "—" sui vuoti) + sotto la
`ReferentiSection`. Pattern derivato da `menu/[menuId]`.

### Sezione referenti — `ReferentiSection` self-loading, render a tabella, form-in-Card

`ReferentiSection` (in `components/referenti/`) è self-contained: legge le permission via `useAuth`
internamente, fa fetch on-mount dei referenti dell'azienda + refetch on mutation (no react-query),
e riceve dal detail solo `aziendaId`. CRUD: create/edit via `ReferenteForm` (form-in-Card, 6 campi,
zod+RHF, select nativo ruolo, email opzionale), soft-delete via `ConfirmDialog`. Lista referenti
resa a **tabella** (colonne nome/ruolo/contatti/stato/azioni, badge attivo/non-attivo) per coerenza
visiva con `clienti/page.tsx`.

### Active-state Sidebar — match per prefisso (chiude TD-BU per accountant)

`isActive = pathname === href || pathname.startsWith(`${href}/`)`: la voce "Clienti" resta attiva
sul detail `clienti/[id]`. I 3 href (`dashboard`/`clienti`/`fatture`) non sono l'uno prefisso
dell'altro → nessun falso positivo. Chiude il TD-BU (match esatto che spegne le sub-route) per il
verticale accountant.

### Entry-point al detail — nome-link + coesistenza

La lista `clienti` rende il `nome` come `<Link>` al detail (`/t/<slug>/clienti/<id>`), mantenendo
Modifica/Elimina inline (coesistenza, DP-c3b-3): la lista per le operazioni rapide, il detail per
referenti + scheda.

### Mapping errori — confine lean

`E_REFERENTE_NOT_FOUND` mappato in `error-codes`; i validation backstop `E_REFERENTE_*` sono
prevenuti dalla zod client-side → fallback generico (stesso §confine di ADR-0032/0033).

### Seed referenti demo

`seedDevReferenti(tenantId)` (in `seed.ts`, dopo `seedDevAziende`): 3 referenti su `studio-demo`
(2 su AZ001, 1 su AZ002 con `attivo=false`), agganciati per `codice` dell'azienda parent (lookup
naturale stabile → niente refactor del return di `seedDevAziende`), idempotente find-then-create
su `(tenantId, aziendaId, nome)`. Lista detail non-vuota per lo smoke; badge "Non attivo"
dimostrato da Laura Bianchi (AZ002).

## Scelte implementative (verbale STOP 2)

Divergenze dallo spec STOP 1, valutate e **accettate** come migliorie/semplificazioni:

1. Componenti in `components/referenti/` (non `components/aziende/`): dominio proprio, più pulito;
   `ConfirmDialog` resta condiviso in `components/aziende/` e riusato cross-folder (nessun duplicato).
2. `ReferentiSection` legge le permission via `useAuth` internamente (non props dal detail):
   autosufficiente, una prop in meno.
3. Render referenti a **tabella** (non `<ul>`): coerenza con la lista clienti.
4. **Detail header read-only**, senza toggle di edit dell'azienda: l'edit azienda resta inline
   nella lista (coesistenza) → nessuna perdita di funzionalità. Edit-in-detail = incremento futuro
   se servirà (non un TD aperto: scelta di scope, non debito).
5. 404 azienda unificato con loadError in un solo Alert (+ retry): equivalente UX al ramo `notFound`
   dedicato di `menu/[menuId]`.
6. i18n: `notFound` (vs `detailNotFound`), `newReferente`/`listEmpty`, chiavi `col.*` per la tabella:
   naming più esplicito, coerente tra section e messages.
7. slug da `useParams` (lista + detail) invece di `useAuth().tenant`: diretto, lo slug è nel path.

## Files

| File                                                                         | Type                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `apps/accountant-web/src/lib/referenti-types.ts`                             | new                                                       |
| `apps/accountant-web/src/lib/referenti-api.ts`                               | new                                                       |
| `apps/accountant-web/src/components/referenti/ReferenteForm.tsx`             | new                                                       |
| `apps/accountant-web/src/components/referenti/ReferentiSection.tsx`          | new                                                       |
| `apps/accountant-web/src/app/t/[slug]/(authenticated)/clienti/[id]/page.tsx` | new                                                       |
| `apps/accountant-web/src/lib/aziende-api.ts`                                 | mod (+`getAzienda`)                                       |
| `apps/accountant-web/src/lib/error-codes.ts`                                 | mod (+`E_REFERENTE_NOT_FOUND`)                            |
| `apps/accountant-web/src/components/shell/Sidebar.tsx`                       | mod (active-state prefisso)                               |
| `apps/accountant-web/src/app/t/[slug]/(authenticated)/clienti/page.tsx`      | mod (entry-point nome-link)                               |
| `apps/accountant-web/src/i18n/messages/{it,en}.json`                         | mod (aziende.backToList/notFound + namespace `referenti`) |
| `packages/db/prisma/seed.ts`                                                 | mod (`seedDevReferenti`)                                  |
| `docs/architecture/ADR-0034-referenti-ui.md` + `PROGRESS.md`                 | new/mod                                                   |

## Gate

- typecheck 16/16 · lint · next lint (accountant-web) no warnings · format clean
- build accountant-web OK — route `/t/[slug]/clienti/[id]` presente (3.94 kB)
- db:seed ×2 idempotente (run1 referenti 3 created, run2 0); verifica DB: 3 referenti su `studio-demo`
- **Smoke browser** (Nicolò, pre-merge) — vedi PR.

## Tech debt

Nessuno nuovo. **TD-RLS-aziende+referenti** resta l'unico aperto sul dominio (backend, RLS DB-level
non esercitata da e2e superuser né da smoke:rls-core). La UI non lo tocca.

## Reversibility

Slice FE additiva: rimuovere i file nuovi (`referenti-*`, `components/referenti/`, `clienti/[id]/`),
revertire le mod (Sidebar, lista, error-codes, aziende-api, i18n) e l'helper seed riporta allo stato
ADR-0032/0033. Backend referenti intatto.
