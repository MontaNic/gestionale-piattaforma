# ADR-0069 — Attivazione layer Comanda (KDS PR-1, BE)

**Status:** Accepted
**Date:** 2026-07-02
**Related:** ADR-0067 (aggregato Conto, layer Comanda differito), ADR-0068 (operatività comande, `comande.stato.cambia` orfano), ADR-0021 (soft-delete RLS-aware), ADR-0009 (RLS reali), ADR-0058 (F2 Tavoli), ADR-0063 (tiering STOP-gate)

## Context

Il blocco COMANDE è completo (#151 dati, #152 operatività, #154 FE core, #155 integrazione tavoli). **Il KDS è il secondo blocco della sequenza** (Comande → **KDS** → Cassa pre-fiscale). ADR-0067 aveva **differito** il layer `Comanda`: _"si aggancerà in modo additivo con `comandaId` nullable sulla riga quando il blocco KDS arriverà. PR-1 NON predispone campi."_ Il trigger è scattato.

Ground-truth (STOP 0 KDS, verificato): oggi lo stato vive **solo** su `Conto` (nessuno stato per-riga); `addRiga` è immediato e individuale (nessun concetto di "invio"); **non esiste** né il model `Comanda` né la colonna `comandaId` — solo prosa negli ADR. Nessuna infra push (WebSocket/SSE/pub-sub) in tutto il monorepo. Il permesso `comande.stato.cambia` è l'orfano-in-attesa il cui consumer è **questo** blocco.

Il KDS è 3 PR: **PR-1 = BE completo (questa)**, PR-2 = FE cameriere (invio), PR-3 = FE KDS (board cucina). Tier **ALTO** (migration + BE live su schema/permessi condivisi `packages/db`), STOP-gate pieno.

## Decision

### 1. Attivazione del layer `Comanda` — invio split per reparto

Nuovo aggregato tenant-scoped `Comanda` (tabella `comande`). L'**invio** (`POST /conti/:id/invia`) prende tutte le righe **pending** del conto (`comandaId IS NULL`, non stornate) e le **splitta server-side per reparto**: crea **N comande, una per ogni reparto presente** (`cucina`/`pizzeria`/`bar`), settando `comandaId` sulle righe. La Comanda porta `reparto` (== reparto delle sue righe), `stato`, e i timestamp di transizione. Lo snapshot resta sulle righe (`nomeArticolo`/`reparto`/`quantita`/`note`) — la Comanda non duplica dati di riga.

**Perché split per reparto:** un ticket cucina e un ticket bar sono destinazioni fisiche diverse; il board KDS filtra per `reparto`. Raggruppare per reparto all'invio è la granularità naturale del display e mantiene ogni comanda omogenea (un solo reparto → indice `(tenant_id, stato, reparto)` copre il feed).

### 2. Stato `StatoComanda` forward-only

`inviata → in_preparazione → pronta`. **Forward-only**: una transizione è valida sse il target viene _dopo_ lo stato attuale (mai indietro, mai sullo stesso) → altrimenti **409 `E_COMANDA_INVALID_TRANSITION`**. È **ammesso lo skip `inviata → pronta`** (cucina veloce): il vincolo è "mai indietro", non "un passo alla volta" — vietare lo skip aggiungerebbe attrito senza valore. Ogni transizione valorizza il proprio timestamp (`inPreparazioneIl`/`prontaIl`). **Nessuno stato `servita`** (consegna in sala = fuori scope KDS-core). Audit-in-tx (`comanda.stato_cambiato`).

### 3. `note String?` sulla riga (stessa migration)

Annotazione cucina per-riga (es. "senza glutine", "cottura al sangue"), inclusa nel feed KDS. **AI/NL fuori scope** (note-cucina generate/parse-ate = decision point post-KDS-core): qui è solo un campo testo libero opzionale, popolato dal FE cameriere in PR-2.

### 4. Righe inviate immutabili

Una `ContoRiga` con `comandaId != null` è **immutabile**: `PATCH .../righe/:rId` e `DELETE .../righe/:rId` → **409 `E_RIGA_ALREADY_SENT`**. Questo implementa finalmente la semantica dichiarata (mai realizzata) del permesso `comande.modifica` = _"Modifica comande non ancora inviate"_. `addRiga` resta invariato: le nuove righe nascono **pending** (`comandaId` NULL) e sono modificabili fino all'invio. Un secondo invio raccoglie le nuove pending → nuova comanda.

### 5. Feed KDS — query singola, niente prezzi

`GET /comande` (permesso `comande.visualizza`), query singola con `include` righe + join tavolo (**niente N+1**):

- **Filtri:** `stato?` (singolo `StatoComanda`), `reparto?`, `contoId?`.
- **Default (stato assente) = comande NON-pronte** (`inviata` + `in_preparazione`): il board cucina di norma vuole solo ciò che resta da preparare, e questo evita al FE una CSV su ogni poll. Uno `stato` esplicito filtra quello (es. `stato=pronta` per lo storico breve).
- **Include:** righe (`nomeArticolo`, `quantita`, `note`, `reparto`) + `contoId` + **`tavoloNumero`** (join leggero `Comanda→Conto→Tavolo`, risolto lato BE — il display cucina mostra il numero, non l'id). **MAI i prezzi** (`prezzoUnitario` non selezionato): la cucina non li usa, il feed resta snello.
- **Ordinamento `inviataIl asc`** (FIFO cucina).

### 6. Semantica feed su chiudi/annulla conto (variante (i))

Nessuna transizione automatica di stato comanda su chiudi/annulla del conto (niente cascade di stato): solo **visibilità nel feed**.

- **Conto `annullato`** → le sue comande **escono dal feed** (la cucina non deve preparare piatti di un conto annullato).
- **Conto `chiuso`** (pagato) → le comande **restano** nel feed finché non-pronte.

Implementazione: il feed filtra `conto.stato != 'annullato'` (mostra `aperto ∪ chiuso`, esclude solo `annullato`). **Perché la variante (i) e non "solo conti aperti":** la chiusura del conto (= pagamento) non deve ostaggiare la cucina — un conto chiuso in fretta non deve far sparire dal pass una comanda ancora in preparazione. Escludere solo `annullato` è la semantica corretta; costa un solo predicato relazionale nel where.

### 7. FK `ContoRiga.comandaId` → `onDelete: SetNull`

Le comande **non si hard-deletano** (soft-delete come il resto del dominio food). `SetNull` è la **valvola di sicurezza per il purge-tenant cascade**: `tenants → conti → (conti_righe, comande)` sono due cascade path che convergono; un `RESTRICT` su `comanda_id` rischierebbe un deadlock referenziale (Postgres verifica RESTRICT immediatamente, senza sapere che le righe referenzianti verranno cancellate nello stesso statement). `SetNull` elimina il rischio senza mai perdere righe in operatività reale (dove le comande non si cancellano).

**Limite dichiarato del vincolo (non "riparare" senza leggere qui):** il rovescio semantico di `SetNull` è che un hard-delete di una Comanda rimetterebbe `comandaId = NULL` sulle sue righe → tornerebbero **pending e quindi mutabili** (perdendo l'immutabilità del §4). In operatività questo **non accade mai**: le comande si soft-deletano soltanto, e l'unico hard-delete è il `purge-tenant`, dove conto/righe/comande spariscono tutti insieme (nessuna riga "orfana riattivata" sopravvive). La scelta è quindi corretta _dato_ l'invariante "comande mai hard-deleted"; chi in futuro volesse cambiare la FK in `RESTRICT`/`Cascade` deve prima riconsiderare il deadlock purge-tenant sopra, non solo questa nota.

### 8. RLS FORCE identico a `conti`/`conti_righe`

`comande` è tabella nuova tenant-scoped → policy `comande_tenant_isolation` replicata **1:1** dal pattern `conti` (migration #151): `ENABLE` + `FORCE ROW LEVEL SECURITY`, `USING (is_super_admin OR tenant_id = current_setting('app.tenant_id'))`. Verificata da un test dedicato al layer DB come ruolo `gestionale_app` (NOSUPERUSER/NOBYPASSRLS): tenant B non legge/muta/inserisce le comande di A (fail-closed), non solo dal GATE verde.

### 9. Nessun permesso nuovo

Vista feed = `comande.visualizza`; invio = `comande.modifica` (opera sulle righe del conto); transizioni = `comande.stato.cambia` (l'orfano trova qui il consumer). Catalogo permessi invariato (**60**).

## Deferral

### SSE/push — deferred, trigger-gated

Il feed KDS in PR-1..PR-3 si aggiorna a **polling leggero** (hook `usePollingRefresh` già in prod: refetch on-interval a tab visibile + on-focus, no dipendenze). Non esiste infra push nel monorepo (né WebSocket/SSE, né Redis pub/sub — Redis è solo cache/throttler/lockout) e Caddy passerebbe WS/SSE ma con `encode gzip` a livello site (buffering potenziale su `text/event-stream`). Un SSE minimo in Nest richiederebbe net-new: una sorgente eventi in-process (rxjs `Subject`), il wiring dei punti-mutazione (invio/transizioni) per emettere, e — se multi-istanza — Redis pub/sub.

**Trigger di riattivazione:** _latenza del polling insufficiente sul feedback reale della cucina_ (l'operatore percepisce ritardo tra "pronta" e display) **oppure** _deployment multi-istanza dell'API_ (dove il polling per-istanza e l'assenza di fan-out diventano un problema). Finché il polling regge su singola istanza, SSE sarebbe build-ahead senza consumer (YAGNI).

### Altri deferral

- **FE** (PR-2 cameriere invio, PR-3 board KDS): fuori da questa PR.
- **AI note/upselling**: decision point post-KDS-core.
- **Stato `servita`** (consegna in sala): fuori scope.
- **Stampa fisica comande** (stampanti di reparto): fuori scope.
- **`sedeId` multi-sede** sulla Comanda: additivo nullable con trigger multi-sede (come Conto).

## Consequences

- Migration additiva (ADD COLUMN nullable + CREATE TABLE + RLS): righe esistenti intatte, `comanda_id`/`note` NULL. Verificato su dati sintetici pre-esistenti (throwaway).
- Nuovi error code: `E_COMANDA_NO_RIGHE_PENDING`, `E_COMANDA_NOT_FOUND`, `E_COMANDA_INVALID_TRANSITION`, `E_RIGA_ALREADY_SENT`, `E_COMANDA_STATO_INVALID`, `E_COMANDA_REPARTO_INVALID`, `E_COMANDA_CONTO_INVALID`.
- Il fixture E2E `comande` grant `full` ora include `comande.stato.cambia` (non più orfano): coerente con l'attivazione.
- **Impatto sull'altro verticale: verificato** — schema/migration toccano solo `comande`/`conti_righe` (dominio restaurant); nessuna tabella accountant coinvolta; migration additiva innocua nella catena comune `packages/db`.
