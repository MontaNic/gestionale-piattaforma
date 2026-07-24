# ADR-0077 — Note Spese v1 PR-4 (FE: UI operatore)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [spec](../spec/note-spese-v1.md) §8/§6/§4, [ADR-0076](./ADR-0076-note-spese-pr3-state-machine.md) (state machine), [ADR-0075](./ADR-0075-note-spese-pr2-crud-storage.md) (CRUD+storage), [ADR-0044](./ADR-0044-documenti-module.md) (pattern feature page)

## Context

Primo frontend del blocco Note Spese: **UI operatore** in `accountant-web`, consumer del backend PR-2/PR-3. **Tier MEDIO**, nessun tocco a BE/schema/seed/packages condivisi. Split per flusso/permesso: **PR-4 = chi sostiene le spese** (`notespese.gestisci`); **PR-5 = chi le decide** (`notespese.approva`, pannello approvazione).

**Prerequisito emerso in STOP 0 → PR-3a (#179)**: i read path BE non esponevano gli allegati e non esisteva un `GET` lista allegati, quindi il badge "giustificativo/scontrino mancante" (§8), l'indicatore di presenza in riga (§2) e la vista/download degli allegati di una nota già salvata erano **infattibili**. Chiuso con una micro-PR additiva prima del FE.

## Decisioni di interazione (DP-1..DP-4) — non coperte da §8, **reversibili**

- **DP-1** — click sul giorno del calendario **seleziona** e mostra le note nella colonna dettaglio; **non** apre il form.
- **DP-2** — "nuova nota" pre-compila `data` col giorno selezionato; senza selezione → oggi.
- **DP-3** — sotto 860px colonna singola con navigazione a **stack** (viste → dettaglio giorno → form); su desktop due colonne, **nessun container fisso 480px** (vincolo esplicito §8).
- **DP-4** — navigazione mese prev/next + ritorno a "oggi"; il mese guida il fetch (`?mese=YYYY-MM`).

## Divergenza dalla spec §1 (dichiarata)

La spec diceva di **riusare gli enum esportati da `packages/db`** (re-export additivo di PR-2). La convenzione reale di `accountant-web` è l'opposta e documentata nel codice: **zero import di `@gestionale/db` nel FE** (verificato: nessuna occorrenza in `apps/accountant-web/src`); gli enum si **replicano** come string-union + `const` array nel `*-types.ts` della feature (vedi `documenti-types.ts`, `scadenze-types.ts`). Seguire la spec alla lettera avrebbe introdotto la **prima dipendenza dal package DB nel frontend**. Scelta: seguire la convenzione del codebase; il re-export resta al servizio del backend.

## Architettura

- **`note-spese-types.ts`** — domain types (Decimal/DateTime come `number`/`string` normalizzati), enum replicati, helper di dominio per i warning (`allegatiMancanti`, `distanzaKmFuoriContesto`, `isEditabile`).
- **`note-spese-api.ts`** — wrapper sopra `@gestionale/api-client`; allegati via `apiPostMultipart`/`apiGetBlob` (mai chiamate HTTP raw → coperti dal single-flight refresh #160). Save bundle nel wrapper. **Wire→domain nel client**: `totale`/`distanzaKm` stringa→number, `data` ISO→`YYYY-MM-DD` (pattern `scadenze-api`). Verificato sul BE reale: `totale` arriva come `'42.5'`, `data` come `'…T00:00:00.000Z'`, e il `POST` **non** include `allegati` → normalizzazione difensiva `?? []`.
- **`CalendarioMese`** — griglia mensile **costruita da zero** (nessun calendario esisteva nel repo, nessuna dipendenza date aggiunta): lunedì-first da `Intl`, aritmetica UTC (la data è date-only, niente drift di fuso), totale+conteggio per giorno. Giorno **senza note** distinto da giorno **a zero**: il primo non mostra importo.
- **`note-spese-image.ts`** — compressione client-side **costruita da zero**: resize 1280px lato lungo + JPEG q0.7, **solo immagini** (i PDF passano intatti), output `image/jpeg` che resta nella allow-list BE, **fallback sull'originale** se fallisce o non riduce.
- **D6 prevenuto a monte**: scegliendo un mandato l'azienda è forzata a quella del mandato; cambiando azienda un mandato incoerente si azzera → la combinazione invalida non è componibile. Messaggio dedicato come rete di sicurezza.
- **Gating come hint, non gate**: i badge anticipano il rifiuto di `invia` (§4.1/§4.2) ma non bloccano; l'autorità resta il BE. Idem `distanzaKm` (§4.6/D4).

## GATE runtime (dev Sub-B, mai prod)

Verifica nell'app reale con **ruolo NON-superuser** (`collaboratore@studio.local`, Collaboratore), browser reale, desktop 1280 + mobile 390:

- viste, toggle, navigazione mese, selezione giorno, stati vuoti, badge mancanti — ok, zero errori console;
- ciclo completo: crea → `invia` senza allegati → **422 giustificativo** → allega PDF → `invia` → **422 scontrino** → allega PNG → `invia` → `inviata` + sola lettura; delete con conferma;
- compressione sul dato reale: **PNG 5.26 MB → `image/jpeg` 75.8 KB**; PDF 0.2 KB invariato.

**Tre difetti trovati dai gate e corretti** (nessuno visibile al typecheck):

1. **Rifiuto BE invisibile** — `invia`/`delete allegato` invocati con `void` senza `try/catch`: la rejection finiva in _unhandled rejection_ e l'utente non vedeva alcun messaggio. Il gating §4.1/§4.2 — il cuore della feature — era muto in UI. Ora la rejection diventa messaggio a schermo (verificato).
2. **Toggle senza nome accessibile** — sotto `sm` i bottoni vista sono icon-only con la label nascosta: nessun accessible name. Aggiunto `aria-label` (confermato dal fatto che il toggle mobile è tornato raggiungibile).
3. **`ConfirmDialog` mai montato** — import e handler orfani dopo un'edit fallita in silenzio; intercettato da **eslint**, poi verificato a runtime.

## Consequences

- **Positive**: superficie operatore completa e provata nell'app reale; invariante "nessuna chiamata HTTP raw" preservata (grep = 0); i18n it/en senza stringhe hardcodate; calendario e compressione riusabili.
- **Costi/rischi**: DP-1..DP-4 sono decisioni di interazione non coperte da §8 → reversibili senza costo strutturale. Il calendario è custom (nessuna libreria): se le esigenze crescono (range, ricorrenze) va rivalutato. **PR-5** resta il pannello approvazione (`notespese.approva`): vista separata, `approva`/`respingi`, compressione non pertinente.
