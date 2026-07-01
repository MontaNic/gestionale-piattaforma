# ADR-0068 — Operatività COMANDE: endpoint conti, resolver pricing, RBAC, state machine

**Status:** Accepted
**Date:** 2026-07-01
**Related:** ADR-0067 (aggregato Conto, PR-1), ADR-0021 (soft-delete RLS-aware), ADR-0009 (RLS reali), ADR-0019 (F1 Menu/pricing), ADR-0058 (F2 Tavoli), ADR-0063 (tiering STOP-gate)

## Context

PR-1 (ADR-0067) ha portato su `main` le fondamenta dati del blocco COMANDE: aggregato `Conto`→`ContoRiga`, RLS FORCE, snapshot pricing (colonne indipendenti), soft-delete. Restava orfana l'**operatività**: nessun endpoint, i 5 permessi `comande.*` seedati ma non enforced (0 `@RequirePermissions`).

**PR-2** costruisce il modulo `conti` (restaurant-api): apri/aggiungi-riga/modifica-riga/storna-riga/chiudi/annulla, enforcement RBAC, audit-in-tx, coerenza canale↔tavolo, state machine, e il **resolver prezzo-per-canale** (il nodo tecnico D2). Tier **ALTO** (nuovo modulo con mutazioni + RBAC + audit su schema/permessi condivisi), STOP-gate pieno. **Nessuno schema/migration** (aggregato già su main), **nessun permesso nuovo** (catalogo resta 60), **nessun FE** (→ PR-3), **nessun AI** (blocco separato).

## Decision

### Resolver prezzo-per-canale (D2) — banale + fail-fast

Lo STOP 0 pricing ha misurato i dati reali: **1 solo listino attivo per canale** (0 overlap in prod), `priority` tutti 0, finestre validità mai valorizzate. Ma **modello e service NON impediscono** due listini attivi sullo stesso canale (nessun `@@unique` tenant+channel; il service controlla solo il nome). Quindi:

- Resolver: `channel → PriceList attivo che include il canale → ArticlePrice(article, list) ∨ Article.basePrice`.
- **≥2 listini attivi sul canale → fail-fast `E_PRICE_AMBIGUOUS`** (409): mai un prezzo non-deterministico. La guardia è _esercitata_ da un test che crea davvero la collisione.
- **0 listini → `basePrice`** (fallback); **1 listino → override se presente, altrimenti basePrice**.
- Core puro `resolveUnitPrice` (no DB/NestJS) → 6 unit test isolati; `PricingService` carica i dati dal tx e delega.
- Snapshot congelato all'aggiunta riga: `prezzoUnitario` (resolver), `nomeArticolo` (`Article.name`), `reparto` (`Article.printDepartment`). Provato a livello dati: mutando `articles`/`article_prices` via SQL la riga non cambia.

#### TD-pricing-multilistino (dormiente, trigger-gated)

`priority` e le finestre `validFromDate`/`validToDate` **non sono usate** dal resolver: sono colonne dormienti. Il trigger di riattivazione è **dati reali con ≥2 listini attivi sovrapposti su un canale** (multi-listino stagionale/promozionale). Quando comparirà, il resolver evolverà da fail-fast a selezione (priority + validità) con test sul tie-break. Finché il consumer non esiste, aggiungere la selezione sarebbe debito additivo (YAGNI).

### RBAC (D4) — 4/5 enforced, `stato.cambia` orfano intenzionale

| permesso               | operazioni                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `comande.crea`         | `POST /conti` (apri conto)                                                                                                 |
| `comande.modifica`     | `POST /conti/:id/righe` (aggiungi), `PATCH .../righe/:rId` (modifica), `POST /conti/:id/chiudi`, `POST /conti/:id/annulla` |
| `comande.elimina`      | `DELETE .../righe/:rId` (storno)                                                                                           |
| `comande.visualizza`   | `GET /conti`, `GET /conti/:id`                                                                                             |
| `comande.stato.cambia` | **NESSUN endpoint (orfano intenzionale)**                                                                                  |

**`comande.stato.cambia` = orfano-in-attesa, NON dimenticanza.** La sua descrizione seed ("Cambio stato (cucina/bar)") è semanticamente **livello KDS** (routing per reparto di una comanda inviata in cucina), non lifecycle del conto. Il suo consumer è il **blocco KDS**, differito. PR-2 non lo mappa a `chiudi/annulla` (che sono lifecycle conto → `comande.modifica`) per non forzare una semantica sbagliata. Resta enforced-da-nessuno finché il KDS non arriva. Enforcement dei 5 verificato via E2E con RBAC reale (viewer→403, ruolo operativo→201/200).

### Coerenza canale↔tavolo (D3) — nel service

Check applicativo (non DTO): `cassa ⇒ tavoloId obbligatorio`; `asporto`/`delivery`/`menu_online` ⇒ `tavoloId` **assente**. Violazione → **`E_CONTO_CHANNEL_TAVOLO_MISMATCH` (400)** — input malformato (combinazione impossibile), distinto dal 409 di stato. Se `tavoloId` è presente ma inesistente/di altro tenant → `E_TAVOLO_NOT_FOUND` (404).

### State machine (D5)

`StatoConto`: `aperto → {chiuso, annullato}`, entrambi **terminali**. Ogni mutazione (aggiungi/modifica/storna riga, chiudi, annulla) esige stato `aperto`, altrimenti **`E_CONTO_NOT_OPEN` (409)** — richiesta valida in conflitto con lo stato corrente della risorsa (distinto dal 400 di coerenza). `chiusoIl` valorizzato solo alla chiusura (annullato non è "chiuso"). Totale conto = derivato in read su righe live (mai persistito — YAGNI).

### Soft-delete storno — via service (path ADR-0021)

Lo storno riga usa `tx.contoRiga.update({ deletedAt })` dentro `withTenantContextAtomicTx` (mai `tx.delete()`, che sotto RLS non-superuser darebbe P2025 — caveat ADR-0021, era il forward dichiarato in ADR-0067). Riga stornata: invisibile nelle GET, esclusa dal totale, fisicamente presente.

### Nota tecnica — tipo `TenantTx` (pattern riusabile)

`Prisma.TransactionClient` (base) **non è assignabile** al `tx` del client esteso: l'estensione soft-delete aggiunge metodi (`forceDelete`) e `InternalArgs` diversi (stesso mondo del caveat ADR-0021). Per passare il `tx` a un service collaboratore (qui `PricingService`, tipizzato) si usa `TenantTx = Omit<ExtendedPrismaClient, '$connect'|'$disconnect'|'$on'|'$transaction'|'$use'|'$extends'>` in `apps/restaurant-api/src/common/tenant-tx.type.ts`. **È un pattern che i moduli food futuri con service collaboratori dentro un tx re-incontreranno** — vive in `common/` proprio per essere trovabile, non riscoperto.

## Consequences

- Le comande sono operative end-to-end (BE): PR-3 può costruire il FE sopra endpoint già enforced e testati. Il resolver pricing è pronto anche per la **cassa** futura (snapshot congelato = integrità storica).
- **Permessi invariati = 60** (PR-2 li _enforce_, non li aggiunge). 4/5 `comande.*` ora enforced; `comande.stato.cambia` orfano intenzionale in attesa del KDS.
- **TD registrato:** `TD-pricing-multilistino` (priority/validità dormienti, riattivazione trigger-gated su dati multi-listino reali).
- **Pattern registrato:** `TenantTx` per il passaggio del tx esteso a service collaboratori.
- Forward: blocco **KDS** (comanda inviata in cucina, `comande.stato.cambia`, `comandaId` additivo sulla riga); **cassa pre-fiscale** (consuma lo snapshot); coerenza pricing multi-listino quando i dati la richiederanno.
