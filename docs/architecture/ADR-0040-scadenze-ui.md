# ADR-0040 — Scadenze UI (lista calendario fiscale + form scadenze)

- **Status:** Accepted
- **Date:** 2026-06-11
- **Relates:** ADR-0039 (scadenze backend / pattern categorie piattaforma+custom), ADR-0037 (preventivi UI / normalizzazione wire→domain), ADR-0032 (aziende UI / pattern lista+form+ConfirmDialog), ADR-0030 (accountant-web skeleton / Sidebar)
- **Slice:** FULL — primo modulo UI del verticale che consuma reference data (categorie) e un enum di visibilità con regola condizionale; ADR dedicato per documentare le scelte di filtro client/server e i limiti del PATCH.

## Context

Backend scadenze completato in ADR-0039 (PR #88). Mancava la UI in `accountant-web`.
Endpoint: `GET/POST /scadenze`, `GET/PATCH/DELETE /scadenze/:id`, `GET/POST /scadenze/categorie`.
Pattern di riferimento: `clienti/page.tsx` (lista + form inline in Card + ConfirmDialog) +
`AziendaForm`/`PreventivoForm` (RHF + zod + `<select>` nativo `SELECT_CLASS`).

La scadenza è tenant-level (NON nested sotto azienda): la route è `/t/[slug]/scadenze`,
non una sezione del detail cliente. È il primo modulo operatore-studio con una propria
voce di sidebar dedicata oltre a clienti/dashboard.

## Decisions

**DP-1 — Route top-level + voce di sidebar.** `/t/[slug]/(authenticated)/scadenze/page.tsx`
(non nested). Sidebar: aggiunta voce `scadenze` (icona `CalendarDays`) dopo `clienti`. Il
file reale usa il pattern `{ key, icon }` (href = `/t/${slug}/${key}`, label = `t('shell.nav.'+key)`),
NON `{ href, label }` come ipotizzato nel prompt → seguito il pattern reale, union `key`
esteso con `'scadenze'`.

**DP-2 — Normalizzazione `dataScadenza` nel layer api (ADR-0037 Gotcha).** `@db.Date`
serializza come ISO datetime completo → `scadenze-api.ts` normalizza a date-only
`.slice(0,10)`, una volta sola (come `validoFino` in preventivi-api). Il domain type
`Scadenza.dataScadenza` è già `string` YYYY-MM-DD; i componenti non fanno conversioni.

**DP-3 — Lookup client-side per categoria/azienda (nessuna relazione embedded).** La lista
`GET /scadenze` ritorna oggetti Prisma grezzi senza `categoria`/`azienda` joinate. Il colore
della categoria (dot) e il nome azienda si risolvono con due `Map` costruite da
`getScadenzeCategorie()` + `listAziende()` (riuso aziende-api), fetchate una volta. Le stesse
liste popolano i `<select>` del form.

**DP-4 — Partizione filtri backend vs client.** Il backend filtra solo
`aziendaId/categoriaId/attivo/da/a`; `visibilità` NON è un filtro backend. Scelta:

- **backend** (`getScadenze({categoriaId, da, a})`, refetch su cambio): categoria + range date;
- **client-side** (sulla lista già fetchata): `stato` (attive = `attivo`; scadute = `data < oggi`;
  future = `data >= oggi`) + `visibilità` (globali = `tutti`; per azienda = `azienda`).

Separazione netta: il backend riduce il dataset sui filtri "duri", il client deriva i filtri
calcolati/flag. Niente debounce (i date-picker nativi committano in modo discreto).

**DP-5 — Raggruppamento per mese.** La lista arriva già ordinata `dataScadenza asc` dal
backend → raggruppata per `YYYY-MM` preservando l'ordine, label localizzata via
`Intl.DateTimeFormat(locale, {month:'long', year:'numeric'})` (locale da `useLocale()`).

**DP-6 — Form: regola `visibilita='azienda' ⇒ aziendaId` (mirror service).** `ScadenzaForm`
(RHF + zod, pattern AziendaForm). `superRefine` rende `aziendaId` obbligatorio quando
`visibilita='azienda'`; il `<select>` azienda è visibile SOLO in quel caso. Cambiando
visibilità verso `tutti`/`utente` si azzera `aziendaId` nel form (`setValue('','')`), e al
submit `aziendaId` è inviato solo per `visibilita='azienda'`.

**DP-7 — Gating permessi.** Azioni di gestione (Nuova / Modifica / Elimina) gated su
`scadenze.gestisci`; la visualizzazione lista/filtri è implicita (la route è protetta da
`scadenze.visualizza` lato auth). Coerente con `clienti/page` (gating per-azione).

## File

Nuovi: `lib/scadenze-types.ts` + `lib/scadenze-api.ts` +
`components/scadenze/ScadenzaForm.tsx` + route `scadenze/page.tsx`.

Modificati: `components/shell/Sidebar.tsx` (+voce scadenze) + `lib/error-codes.ts`
(+3 codici) + `i18n/{it,en}.json` (+`shell.nav.scadenze`, +namespace `scadenze`).

## Tech debt

- **TD-PATCH-null-FK (nuovo):** il `UpdateScadenzaDto` espone `categoriaId`/`aziendaId` come
  `@IsUUID` opzionali senza supporto `null` → via PATCH non è possibile **azzerare** una FK
  già impostata. In edit, cambiando visibilità da `azienda` ad altro, l'`aziendaId` resta in
  DB (semanticamente ignorato quando `visibilita≠azienda`, e la UI lista mostra il nome
  azienda solo se `aziendaId` valorizzato). Fix futuro: accettare `null` esplicito nel DTO +
  service. Bassa priorità (le scadenze create dalla UI per `visibilita≠azienda` non hanno
  `aziendaId`).
- **Gestione categorie custom non in UI:** `createScadenzaCategoria` è esposta in
  `scadenze-api.ts` (richiesta STEP 1) ma non c'è ancora una UI per creare/gestire categorie
  custom — il form scadenze sceglie solo tra le categorie esistenti (piattaforma + custom).
  Slice successiva candidata.

## Test

Nessun test mirror (nessuna formula client-side — pattern ADR-0032/0034). GATE statico:
typecheck 16/16, lint + next build OK (route `/t/[slug]/scadenze` generata, 4.69 kB).
Smoke browser non-superuser (`collaboratore@studio.local`, ruolo Collaboratore con
`scadenze.*`) a cura di Nicolò pre-merge: lista + raggruppamento mese, filtri categoria/stato,
form crea/modifica/elimina, regola visibilità=azienda.
