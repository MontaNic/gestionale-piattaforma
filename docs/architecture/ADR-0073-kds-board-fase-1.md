# ADR-0073 — KDS board (Fase 1: nucleo funzionale)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0069](./ADR-0069-kds-layer-comanda.md) (layer Comanda / macchina a stati BE), [ADR-0068](./ADR-0068-operativita-comande.md) (flusso cameriere / conti)

## Context

Il layer Comanda BE è completo (feed `GET /comande` + avanzamento `PATCH /comande/:id/stato`, macchina a stati forward-only `inviata→in_preparazione→pronta`, split per reparto all'invio, snapshot `Portata`). Il **flusso cameriere** FE è costruito e in CI. Ma la **board KDS era un placeholder da 5 righe** e i due endpoint feed erano **orfani** (nessun consumer FE): il ciclo cameriere→cucina non si chiudeva. Fase 1 rende la cucina operativa.

## Decisions

- **DP-1 Refresh = polling.** La board si aggiorna via `usePollingRefresh` (visibility-aware, già in uso sulla mappa sala), intervallo `KDS_POLL_INTERVAL_MS = 8s`. **SSE/WebSocket resta deferito**, trigger invariato: latenza insufficiente su feedback reale, o esigenza multi-istanza. Motivazione: il polling chiude il ciclo end-to-end senza infrastruttura realtime; l'upgrade a SSE è un'ottimizzazione con trigger misurabile, non un requisito di Fase 1.
- **DP-2 Kiosk = route group (Fase 2).** Il layout a muro chromeless sarà una route group `(kiosk)/` con layout proprio, **non** un flag condizionale nella shell. Rinviato a Fase 2.
- **DP-3 Due fasi.** Fase 1 = wrapper API + board (feed/raggruppamento/polling) + avanzamento stato. Fase 2 = kiosk layout + segnale storno sulla board + e2e Playwright.

## Fase 1 — cosa consegnato

- **`comande-api.ts`**: `listComande({stato,reparto,contoId})` + `cambiaStatoComanda(id,stato)` sopra `@gestionale/api-client` + `authOptions()`. **Zero `fetch` raw** (invariante restaurant-web preservata). Tipi `Comanda`/`ComandaFeedRiga` **derivati dalla risposta reale del BE** (`ComandaFeedItem`), non inventati; `PORTATA_ORDER`/`REPARTO_ORDER` come costanti d'ordine di servizio.
- **Board `kds/page.tsx`**: colonne per **reparto** (solo presenti, ordine cucina/pizzeria/bar), dentro ogni card righe raggruppate per **portata** in ordine di servizio (non alfabetico). Card: tavolo + badge stato + righe (qty grande, nome, **note cameriere evidenziate** = info critica cucina). Stati loading/errore-retry/coda-vuota (leggibile, è lo stato normale). Tipografia grande / contrasto alto per display a 2-3 metri.
- **Avanzamento forward-only**: pulsante per card → `cambiaStatoComanda(id, next)` con `STATO_NEXT` (subset in-avanti della macchina BE, che ammette anche lo skip). **UI ottimistica + rollback**: override in un layer `pending` applicato subito; a conferma refetch autoritativo poi pulizia; a errore rollback + Alert. Gating su `comande.stato.cambia`.
- **Anti-race polling↔ottimistica** (approccio scelto): le override `pending` **vincono nel render** sopra il feed pollato → un refresh in volo non può regredire visivamente uno stato appena avanzato; l'override si pulisce solo a conferma (dopo refetch, quando il feed riflette già `next` o la comanda pronta è uscita) o a errore (rollback).

**Permessi:** nessun tocco al seed. `comande.visualizza` + `comande.stato.cambia` esistono (catalogo 60) e il ruolo template **`Cucina/Bar`** li ha già; Super Admin li ha entrambi (usato per la verifica).

**Verifica runtime (dev env Sub-B, DB dev 55432, mai prod):** flusso cameriere reale (conto tavolo → righe cucina+pizzeria → invia) → board mostra 2 comande split per reparto, righe per portata, note evidenziate; ciclo avanzamento `Avvia`→`In preparazione`→`Pronta` con la comanda pronta che esce dal feed. Zero errori pagina.

## Consequences

**Positive:** il ciclo cameriere→cucina→avanzamento è chiuso end-to-end; i 2 endpoint feed non sono più orfani; invariante zero-fetch-raw preservata.

**Fase 2 — RESIDUA (trigger espliciti):**

- **Kiosk layout** (DP-2): route group `(kiosk)/` chromeless per il monitor a muro. Trigger = uso reale su un display dedicato.
- **Segnale storno passivo sulla board**: evidenziare le righe `stornata` (già nel wire, non renderizzate in Fase 1). Trigger = primo storno osservato su comanda in coda.
- **e2e Playwright KDS**: spec che esercita invia→board→avanza in CI (il job restaurant-web esiste già). Trigger = prossimo intervento sull'infra e2e / stabilizzazione della board.
- **SSE** (DP-1): trigger invariato = latenza polling insufficiente o multi-istanza.

**Costi/rischi:** il polling a 8s ha una finestra di staleness accettabile per una cucina; l'ottimistica con `pending`-override è semplice ma corretta (nessun react-query, coerente col confine progetto: niente SWR/react-query).
