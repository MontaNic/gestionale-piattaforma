# ADR-0081 — Cassa pre-fiscale PR1: pagamenti come child table, saldo derivato, guardia di chiusura

- **Status:** Accepted
- **Date:** 2026-07-27
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0067](./ADR-0067-modello-aggregato-conto.md) (aggregato Conto/ContoRiga), [ADR-0068](./ADR-0068-operativita-comande.md) (operatività + state machine `chiudi`), [ADR-0069](./ADR-0069-attivazione-layer-comanda.md) (layer Comanda/KDS), [ADR-0070](./ADR-0070-prezzi-lordi-snapshot-aliquota-riga.md) (prezzi lordi + snapshot `vatPercent` — **prerequisito diretto**)

## Context

Terzo blocco della sequenza food **Comande → KDS → Cassa pre-fiscale → RT differito**. I primi due sono chiusi e in produzione. Uno STOP 0 read-only ha fotografato la base:

- `Conto` (testata) e `ContoRiga` (righe con snapshot `nomeArticolo`/`prezzoUnitario`/`vatPercent`/`reparto`/`portata`) esistono, con RLS FORCE, soft-delete e state machine `aperto → {chiuso, annullato}`.
- `computeTotale` esiste ed è una **somma lorda pura** (ADR-0070 D1), derivata in read, mai persistita.
- **Nessun concetto di pagamento esiste**: nessun campo importo-pagato/metodo/resto, nessuno stato-pagamento, nessuno scorporo imponibile/IVA, nessun modello di movimento cassa.
- I 4 permessi `cassa.*` erano **seedati e orfani**: zero `@RequirePermissions('cassa.*')` in tutto il codice.
- `chiudi` era una **pura transizione di stato** + timestamp `chiusoIl` + audit: chiudeva un conto da 200 € senza avere incassato nulla.
- ADR-0070 aveva congelato `vatPercent` sulla riga proprio come prerequisito, dichiarando lo scorporo _"responsabilità della cassa, differito"_. Il trigger è scattato.

L'accountant ha una sua contabilità IVA (`preventivi`, `note-spese`, `AliquotaIvaNotaSpesa`) completamente separata: nessun codice, enum o modello condiviso col lato food.

## Decisioni

### D1 — Pagamento = child table, non campi su `Conto`

Nuovo modello `Pagamento`: 1 conto → N pagamenti. Lo **split payment** (metà carta, metà contanti) è il caso **nativo**; il pagamento singolo è il caso degenere N=1.

`importo` è l'importo **applicato al conto**, non versato. L'overpay non è modellato: guardia applicativa `importo <= residuo` → `E_PAGAMENTO_EXCEEDS_RESIDUO`. Il resto contanti (versato − applicato) è concern FE, non persistito → `TD-cassa-resto-drawer`.

**Motivazione:** campi `metodoPagamento`/`importoPagato` sulla testata avrebbero reso lo split payment un'eccezione da modellare a posteriori — cioè un secondo giro sullo stesso aggregato, su dati già scritti. La child table lo rende il caso base a costo zero.

`operatoreId` è una colonna nuda **senza FK** a `users`: il food non ha `createdBy` da nessuna parte (Menu/Article/Tavolo/Conto), e l'attribuzione forte vive già in `AuditLog.userId`. Storno soft via `stornato`/`stornatoIl` (**non** `deletedAt`, coerente con `ContoRiga.stornata`): un incasso stornato è **esistito** — resta visibile e in audit, esce solo dal residuo. Terminale, no toggle. Non avendo `deletedAt`, il modello è fuori dall'auto-detect della soft-delete extension (come `AuditLog`).

### D2 — Nessun enum stato-pagamento persistito

`da_pagare` / `parziale` / `saldato` è **derivato** (Σ importi non-stornati vs `computeTotale`), mai scritto. `StatoConto` resta invariato.

**Motivazione:** un enum persistito sarebbe un secondo posto dove la verità può divergere da righe e pagamenti — e divergerebbe al primo storno di riga o di pagamento. Stessa scelta già fatta per `totale` ("derivato in read, mai persistito — YAGNI", ADR-0068).

Precedenza: `residuo <= 0` ⇒ `saldato` (copre anche il conto a totale 0, dove non c'è nulla da incassare) → `pagato == 0` ⇒ `da_pagare` → altrimenti `parziale`.

### D3 — `chiudi` acquisisce una guardia di saldo — ⚠️ cambio di contratto

`chiudi` è ammesso **solo** se `residuo == 0` **oppure** `totale == 0`. Altrimenti `E_CONTO_NOT_SETTLED` (409). `annulla` resta la via per uscire da un conto **senza** incasso (errore, no-show, cliente andato via) e non acquisisce alcuna guardia.

**Questo è un cambio di contratto su un path live e testato** (ADR-0068 D5: `chiudi` era una pura transizione). È deliberato e circoscritto: il permesso **non** si sposta (`chiudi`/`annulla` restano su `comande.modifica`), così l'unica cosa che cambia per un chiamante esistente è la guardia. Blast radius misurato e sanato — vedi § Blast radius.

**La seconda clausola non è ridondante.** Con l'overpay bloccato, `residuo == 0` implicherebbe già `totale == 0` per un conto senza pagamenti. Ma lo **storno di una riga già pagata** manda il residuo in **negativo**: con una riga sola il totale torna a 0 e la clausola `totale == 0` salva la chiusura.

**Limite dichiarato (non un bug).** Storno _parziale_ di un conto già saldato (2 righe pagate, se ne storna una): `totale > 0`, `residuo < 0` → chiusura **bloccata**. Via d'uscita: stornare il pagamento e ri-registrarlo al nuovo totale, oppure `annulla`. Non si è allargata la guardia a `residuo <= 0` perché renderebbe chiudibile un conto genuinamente pagato in eccesso, che è la condizione che D1 ha deciso di **non** modellare. Comportamento coperto da test e2e dedicato. Se il pilota reale lo incontra spesso, il trigger per riaprirlo è quello — non un'ipotesi ora.

### D4 — Scorporo derivato + riepilogo IVA congelato alla chiusura

`computeRiepilogoIva` è derivato: raggruppa per `vatPercent` (l'aliquota **snapshottata sulla riga**, non quella corrente dell'articolo) e per gruppo produce `{ vatPercent, lordo, imponibile, iva }` con `imponibile = lordo / (1 + vat/100)` arrotondato a 2 decimali HALF_UP e **`iva = lordo − imponibile`** (differenza, non un secondo arrotondamento) — così `imponibile + iva == lordo` **esattamente** per ogni gruppo. Gruppi ordinati per aliquota crescente (output stabile e confrontabile). Esclude righe stornate e soft-deleted, come `computeTotale`.

Alla chiusura il riepilogo viene **congelato** su `Conto.riepilogoIvaSnapshot` (Json), scritto **una sola volta** da `chiudi`, immutabile per convenzione — nessun trigger DB: è l'unico path che lo scrive e la transizione è terminale. Lo snapshot vive sul **`Conto`, non sul singolo `Pagamento`**: l'IVA è una proprietà di ciò che è stato venduto, non di come è stato pagato; su N pagamenti dello stesso conto sarebbe stata duplicata N volte con l'ambiguità di quale sia quella buona.

`annulla` **non** congela nulla (nessuna chiusura vera → colonna resta NULL). Nessun backfill: NULL è il valore semanticamente corretto per i conti pre-migration, il cui riepilogo-come-allora non è ricostruibile (stesso razionale di ADR-0070 D3). Non essendoci data-migration cross-tenant, non c'è dipendenza da `DIRECT_URL` superuser.

Il riepilogo **live** resta derivato: lo snapshot è la fotografia fiscale, non la fonte di verità del conto aperto.

### D5 — Permessi: +1 (63 → 64), tre `cassa.*` non più orfani

Nuovo `cassa.pagamento.registra`, assegnato ai template **Direzione** (32→33) e **Cassiere** (11→12). Enforcement:

| rotta                                   | permesso                           |
| --------------------------------------- | ---------------------------------- |
| `GET /conti/:id/pagamenti`              | `cassa.visualizza`                 |
| `POST /conti/:id/pagamenti`             | `cassa.pagamento.registra`         |
| `POST /conti/:id/pagamenti/:pId/storna` | `cassa.storno.esegui`              |
| `POST /conti/:id/chiudi` \| `/annulla`  | `comande.modifica` (**invariato**) |

La rotta `GET /conti/:id/pagamenti` dà a `cassa.visualizza` un consumer reale e permette al pannello cassa (PR2) di leggere e ripollare i soli pagamenti senza il payload completo del conto. Il conto completo resta su `comande.visualizza`: un cassiere può vedere i movimenti senza avere i permessi comande, e viceversa.

`cassa.scontrino.emetti` e `cassa.chiusura.giornaliera` **restano orfani di proposito**: il primo è riservato al blocco RT/certificazione fiscale (differito fino a cliente reale), il secondo a D6. Un permesso orfano con semantica chiara è un segnaposto, non un debito — diventa debito solo se qualcuno lo grantasse credendolo attivo, ed è per questo che l'orfanaggio è dichiarato qui e nel seed.

### D6 — Chiusura giornaliera fuori scope

Sessione cassa, Z-report, fondo cassa, riconciliazione cassetto: **Sub-2 differito** → `TD-cassa-chiusura-giornaliera`. `cassa.chiusura.giornaliera` resta orfano.

**Trigger:** il pilota reale chiede il riepilogo di fine giornata. Prima di quel momento non si sa se serva un aggregato per turno, per operatore o per giornata solare — e i requisiti li definisce il primo consumer, non un'ipotesi (stessa logica del defer di TD-BY).

## Superficie

**Schema** (migration `20260726215242_add_pagamento_cassa`, additiva pura):

- `enum MetodoPagamentoConto { contanti, carta, altro }` — `altro` è la valvola per buoni pasto/satispay/bonifico senza inventare un enum speculativo. Distinto da `MetodoPagamentoNotaSpesa` (accountant): **nessun riuso cross-verticale**, domini diversi.
- `model Pagamento` (`@@map("pagamenti")`): `id`, `tenantId`, `contoId`, `metodo`, `importo Decimal(10,2)`, `stornato`, `stornatoIl`, `operatoreId`, `createdAt`, `updatedAt`. Relazioni Cascade tenant+conto **identiche a `Comanda`** (stessa struttura: figlio tenant-scoped di `Conto`). Indici `(tenant_id)`, `(conto_id)`.
- `Conto.riepilogoIvaSnapshot Json?` (`riepilogo_iva_snapshot` jsonb).
- RLS: `pagamenti` `ENABLE` + **`FORCE`** ROW LEVEL SECURITY + policy `pagamenti_tenant_isolation` replicata 1:1 dal pattern `conti`/`conti_righe`/`comande`. Nessun GRANT esplicito: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` (migration `20260513002159`) lo propaga a `gestionale_app`.

**Error codes nuovi:** `E_PAGAMENTO_EXCEEDS_RESIDUO`, `E_CONTO_NOT_SETTLED`, `E_PAGAMENTO_NOT_FOUND`, `E_PAGAMENTO_ALREADY_STORNATO`, `E_PAGAMENTO_METODO_INVALID`, `E_PAGAMENTO_IMPORTO_INVALID`. `E_CONTO_NOT_OPEN` riusato (pagamento/storno su conto terminale).

**Audit** (`action` String libera → **nessuna modifica ad `AuditLog`**): `conto.pagamento_registrato` (con `residuoPrima`/`residuoDopo`), `conto.pagamento_stornato`. `conto.chiuso` **mantiene il nome** (anchor stability per i consumer audit esistenti) ma ora porta `riepilogoIvaSnapshot` in `afterValue`.

**`GET /conti/:id`** estesa con `pagamenti[]` + i tre derivati `residuo`, `statoPagamento`, `riepilogoIva`. Importi come stringhe decimali a 2 cifre (Decimal→string sul wire, mai float).

## Blast radius — D3

Baseline pre-modifica catturata: **16 file, 147 passed | 5 skipped**, exit 0.

Sui 11 punti che chiudono un conto nella suite, **9 chiudono un conto a totale 0** (nessuna riga, o le sole righe soft-deleted) → guardia soddisfatta, invariati. **2 si rompevano by design** e sono stati aggiornati registrando un pagamento a saldo prima di `chiudi` (helper `pagaSaldo`): `invio: conto non-aperto → 409` e `feed: conto ANNULLATO … conto CHIUSO` — dove il commento "conto chiuso (pagato)" è ora letterale.

**Un terzo consumer fuori dalla suite BE:** lo smoke Playwright `comande-flow.spec.ts` chiudeva un conto con totale > 0 dalla UI. La UI per pagare arriva con PR2, quindi il passo finale usa `annulla` — l'altra transizione terminale, che porta il conto fuori da `aperto` e libera il tavolo, cioè esattamente la catena mappa↔conti che quello smoke verifica. La variante paga-poi-chiudi diventa uno spec FE della cassa in PR2.

## Nota sul harness E2E (TD-BS Sub-2)

I DTO `@Body` **non vengono validati** nel harness E2E: la `ValidationPipe` non riceve `design:paramtypes` a runtime. Verificato empiricamente sul DTO **pre-esistente** `AddRigaDto` (`quantita: 0` → 201 invece di 400) → limitazione del harness, non di questa PR, e non una regressione introdotta qui. In prod (`nest build --builder swc`, `.swcrc` `decoratorMetadata`) la validazione produce 400. I constraint di `RegistraPagamentoDto` sono coperti da 11 casi unit (`registra-pagamento.dto.spec.ts`), stesso pattern già usato per `list-conti.query.dto.spec.ts`; l'assert e2e corrispondente è `it.skip` con il marker.

## Consequences

- ✅ La cassa ha fondamenta dati e operatività BE: split payment nativo, storno, residuo e stato derivati, scorporo IVA con invariante `imponibile + iva == lordo` per gruppo.
- ✅ Lo scorporo differito da ADR-0070 è realizzato sui dati che quell'ADR aveva congelato: il riepilogo di un conto chiuso non cambia se l'articolo cambia aliquota (coperto da test).
- ✅ 3 dei 4 permessi `cassa.*` orfani hanno un consumer reale; gli altri 2 (uno nuovo incluso) sono orfani **dichiarati** con trigger.
- ⚠️ **Contratto `chiudi` cambiato**: un client che chiudeva conti non saldati ora prende 409. Nessun consumer esterno esiste oltre a FE restaurant e suite (entrambi sanati); da tenere presente se qualcuno automatizza `chiudi` prima di PR2.
- ⚠️ Storno parziale di un conto già saldato → chiusura bloccata (limite D3 dichiarato, con via d'uscita e test).
- ⚠️ `riepilogoIvaSnapshot` immutabile **per convenzione**, non per vincolo DB: un `UPDATE` manuale lo sovrascriverebbe. Accettato — è la stessa forma di garanzia degli altri snapshot del dominio (`nomeArticolo`, `prezzoUnitario`, `vatPercent`).
- 🆕 `TD-cassa-resto-drawer` — resto contanti / riconciliazione cassetto non persistiti. **Trigger:** il cliente chiede la riconciliazione cassetto/fondo cassa.
- 🆕 `TD-cassa-chiusura-giornaliera` — sessione cassa / Z-report / fondo cassa (D6). **Trigger:** il pilota chiede il riepilogo di fine giornata.

## Fuori scope (con trigger)

- **RT / certificazione fiscale, documento commerciale, scontrino.** _Trigger = cliente reale._ `cassa.scontrino.emetti` è il segnaposto.
- **Cassa FE** (pannello pagamento, tastierino, resto). _→ PR2, speccata dopo che PR1 è verde._
- **Chiusura giornaliera / sessione cassa.** _→ D6._
- **Coperto e varianti prezzate** — erediteranno lo stesso problema aliquota, già dichiarati fuori scope da ADR-0070.

## Impatto sull'altro verticale

**Verificato.** `Pagamento`, `MetodoPagamentoConto` e `riepilogoIvaSnapshot` vivono sotto il confine **DOMINIO** dello schema condiviso. `AuditLog` (CORE) **non è toccato**: `action` è una String libera, le due nuove action non richiedono modifiche allo schema. Grep a zero occorrenze di `Conto`/`ContoRiga`/`Pagamento`/`MetodoPagamentoConto` in `apps/accountant-api` e `apps/accountant-web` (i soli hit sono le re-export del barrel `packages/db/src/index.ts`). Nessun riuso dell'enum accountant `MetodoPagamentoNotaSpesa` — scelta esplicita, non una svista.
