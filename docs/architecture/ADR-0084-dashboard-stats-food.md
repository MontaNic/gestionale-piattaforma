# ADR-0084 — Dashboard food: endpoint `GET /dashboard/stats` (restaurant-api)

- **Stato**: Accettato
- **Data**: 2026-07-28
- **Contesto PR**: PR1 della fase **P2** dell'iniziativa di restyling (ADR-0083 §P2). PR2 = Badge + token additivi, PR3 = dashboard FE che consuma questo contratto.
- **Cross-ref**: clona il pattern di [ADR-0038](ADR-0038-dashboard-stats.md) (dashboard accountant, prima query aggregata del progetto) · [ADR-0009](ADR-0009-rls-real.md) (RLS tenant context) · [ADR-0021](ADR-0021-soft-delete-rls-tx-escape-fix.md) (soft-delete) · [ADR-0081](ADR-0081-cassa-pre-fiscale-pr1-pagamenti.md) (pagamenti, guardia di saldo) · [ADR-0068](ADR-0068-operativita-comande.md) (conti/comande)
- **Slice**: BE only — prima query aggregata del **verticale food**

## Contesto

La dashboard restaurant è ferma alla welcome statica post-login: nome utente, elenco ruoli, dump
di tutti i permessi come chip grigi, bottone "Esci". Nessun dato di dominio, nessuna fetch.

Il preflight P2 ha mappato, KPI per KPI, cosa il BE food espone **oggi** a una dashboard, e il
risultato ha deciso questa PR:

| KPI                  | Cosa esisteva prima di questa PR                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **conti aperti**     | `GET /conti?stato=aperto` → array flat, `.length` lato client. Serve, ma scarica l'intera lista per contarla.                                                                                                                                                                                                                     |
| **comande in corso** | `GET /comande?stato=` → idem, e ogni comanda porta con sé le proprie righe.                                                                                                                                                                                                                                                       |
| **coperti oggi**     | `coperti` è sul payload flat di `Conto`, sommabile a mano — ma **nessun DTO accetta un filtro data**, quindi "oggi" non è esprimibile.                                                                                                                                                                                            |
| **incasso oggi**     | ❌ Non servibile. Gli importi nascono **solo** in `GET /conti/:id` (`totale`/`residuo` derivati in memoria); la lista non li espone — è `TD-conti-list-amounts`, registrato in [ADR-0082](ADR-0082-cassa-pre-fiscale-pr2-fe-chiudibile.md) D5. Calcolarlo client-side = `1 + N` fetch, per giunta su **tutti** i conti di sempre. |

Due mancanze, non una: manca l'**aggregazione** e manca il **confine temporale**. `restaurant-api`
non aveva alcun modulo stats — nessun `count`, nessun `aggregate`, nessun `groupBy` in tutto il
verticale.

## Decisioni

### D1 — Endpoint aggregato, minimale: 4 numeri

`GET /api/v1/dashboard/stats` ritorna esattamente quattro scalari:

```jsonc
{
  "contiAperti": 3, // number
  "comandeInCorso": 5, // number
  "incassoOggi": "482.50", // string decimale a 2 cifre
  "copertiOggi": 47, // number
}
```

**Il valore di questa PR è stabilire il pattern aggregato food, non l'incasso di stasera.** Niente
grafici, niente trend, niente `groupBy` orario, niente confronto con ieri, niente lista "ultimi
conti" (che invece ADR-0038 ha per l'accountant). Ogni riga in più è una riga da mantenere prima di
sapere se qualcuno guarda questi numeri. Le KPI crescono slice dopo slice, come le card accountant.

**Divergenza deliberata da ADR-0038 sul denaro**: là `Decimal` → `toNumber()`; qui `incassoOggi` è
una **stringa** `toFixed(2)`. È la convenzione denaro già in uso su tutte le superfici food
(`Conto.totale`, `residuo`, `riepilogoIva` sono stringhe decimali — ADR-0070/0081), e allinearsi
alla convenzione del proprio verticale vale più che allinearsi all'altro. Il FE food normalizza già
wire→domain in questa direzione.

### D2 — Gate: `report.operativo.visualizza`. Nessun permesso nuovo.

**Zero permessi nuovi = zero riconciliazione Super Admin, zero propagazione al deploy.** Il vincolo
è forte: la propagazione dei permessi ai ruoli esistenti è un passo manuale che il seed non fa (vedi
il blocco deploy S19), quindi un permesso nuovo costa molto più delle sue tre righe di catalog.

`report.operativo.visualizza` esisteva già nel catalog ed era **food-orphan**: zero consumer in
`apps/` per il verticale food. Questa rotta è il suo primo consumer reale — lo stesso schema con cui
la Cassa PR2 ha dato un consumer a `cassa.visualizza`, che era orfano (ADR-0081 D5).

**Verifica empirica fatta prima di scrivere il codice**, in DB dev (`:55432`) e non solo nei template
del seed — la distinzione conta, perché template e `role_permissions` divergono:

| Tenant                       | Ruolo       | `report.operativo.visualizza` |
| ---------------------------- | ----------- | ----------------------------- |
| Demo Pizzeria (food)         | Direzione   | ✅                            |
| Demo Pizzeria (food)         | Super Admin | ✅                            |
| _template_ `Cassiere` (seed) | —           | ✅                            |

`Direzione` e `Super Admin` sono gli **unici** ruoli food istanziati; `Cassiere` esiste come template
ma non è mai stato clonato in un tenant. Nessun ruolo food da riconciliare.

⚠️ **Trovato di lato, non toccato**: su `Studio Ferretti & Lombardi` (accountant) il ruolo `Direzione`
**non** ha `report.operativo.visualizza` pur avendolo il template omonimo — quindi oggi su accountant
solo il Super Admin vede `report/margine`. È una divergenza template↔DB preesistente, estranea a
questa PR; registrata qui perché è la prova che verificare in DB e non nel seed non è pedanteria.

**Divergenza da ADR-0038**: l'accountant ancora la sua dashboard a `anagrafica.cliente.visualizza`
("la dashboard è ancorata ai clienti", scartando esplicitamente `report.*` per semantica diversa).
Qui non esiste un dominio singolo a cui ancorarla — i 4 KPI attraversano conti, comande e pagamenti —
e un permesso `report.*` **operativo** con esattamente quella semantica esiste già.

### D3 — Semantica dei 4 KPI: due sono fotografie, due sono di giornata

Non è una sfumatura: due numeri rispondono a "adesso", due a "oggi", e confonderli produce numeri
che sembrano giusti e non lo sono.

- **`contiAperti`** — `count(stato = aperto)`, **nessun filtro temporale**. È una fotografia. Un
  conto aperto ieri e mai chiuso _deve_ comparire: è esattamente l'anomalia che il numero serve a
  far notare. Filtrarlo per data lo nasconderebbe.
- **`comandeInCorso`** — `count(stato ∈ {inviata, in_preparazione})`. `pronta` **non** è "in corso":
  è lavoro finito in attesa di ritiro. Fotografia anch'essa.
- **`incassoOggi`** — `Σ importo` dei pagamenti **non stornati** creati da inizio giornata.
- **`copertiOggi`** — `Σ coperti` dei conti **aperti oggi**, **inclusi quelli già chiusi**. Il filtro
  è su `apertoIl`, non sullo stato: a fine servizio la maggioranza dei conti di giornata è chiusa, e
  un numero che li escludesse crollerebbe proprio nel momento in cui lo si guarda. `coperti` è
  nullable (l'asporto non ne ha) e la Σ ignora i NULL.

**`incassoOggi` non filtra sullo stato del conto.** `annulla` — a differenza di `chiudi` — non ha
guardia di saldo (ADR-0081 D3), quindi un conto annullato **può** avere un pagamento non stornato.
Quel denaro è entrato davvero in cassa, e lo **storno** è la via esplicita del dominio per farlo
uscire dal totale. `stornato: false` è perciò l'unico predicato corretto.

### D4 — "Oggi" = giornata solare `Europe/Rome`

Il confine è la mezzanotte locale italiana, non UTC: per otto mesi l'anno UTC sposterebbe il taglio
di due ore dentro il servizio serale.

Nessuna dipendenza nuova (no `date-fns-tz`, no `luxon`): l'offset si ricava da `Intl.DateTimeFormat`
formattando l'istante nella zona e rileggendolo come se fosse UTC.

Il calcolo è a **due passaggi, e il secondo non è difensivo**: nei giorni di cambio ora l'offset a
mezzanotte differisce da quello dell'istante corrente, e il candidato calcolato col primo offset
cadrebbe **nel giorno sbagliato**. Il 29/03/2026 alle 14:00 locali siamo in CEST (+2) ma la
mezzanotte di quello stesso giorno era ancora CET (+1). Ricalcolando l'offset _sul candidato_ e
riapplicandolo si ottiene la mezzanotte vera in entrambe le direzioni. In `Europe/Rome` il cambio
cade alle 02:00/03:00 locali → la mezzanotte esiste sempre e non è mai ambigua: nessun caso "ora
inesistente".

`SERVICE_TIME_ZONE` è una costante, non un campo per tenant: oggi ogni tenant food è in Italia. Il
giorno in cui non sarà vero, diventa un campo su `Tenant` e resta l'unico punto da cambiare.

**`TD-dashboard-service-day`** — il "giorno di servizio" reale di un ristorante non è la giornata
solare: un turno che chiude all'01:30 appartiene al servizio della sera prima, e oggi finisce nei
numeri del giorno dopo. _Trigger_: un cliente reale con servizi regolarmente oltre la mezzanotte.

### D5 — Aggregati sotto RLS, senza wrap esplicito

`count`/`aggregate` sono model-op → passano per `$allOperations` dell'extension `rls.ts` → girano
sotto il tenant context dell'interceptor con `SET LOCAL app.tenant_id` (ADR-0009), RLS-filtrati come
le CRUD. Nessun `runInTenantContext` da aggiungere, nessun `$queryRaw`.

`softDeleteExtension` intercetta anche `count`/`aggregate` e inietta `deletedAt = null`, ma **solo
sui modelli che hanno il campo** (gate `modelsWithDeletedAt`): `Conto`/`Comanda` sì, `Pagamento`
**no** — non ha `deletedAt`, il suo storno è il flag booleano `stornato`. Passiamo comunque
`deletedAt: null` esplicito dove il campo esiste: rende leggibile l'intenzione al call-site invece di
farla dipendere dal comportamento di un'extension.

`where: { tenantId }` esplicito mantenuto come difesa in-depth oltre RLS, coerente con
`conti.service` / `comande.service`.

## Verifica

- **Unit** (`dashboard.service.spec.ts`, 8 test) — `startOfDayInTimeZone`. Unit e **non** e2e perché
  l'e2e non controlla "adesso" e quindi non può esercitare i due switch DST, che sono l'unico punto
  in cui un confine di giornata sbaglia davvero — e sbaglia di un giorno intero. Attese espresse sia
  in ISO UTC sia come **round-trip** (l'istante restituito, riletto in `Europe/Rome`, è `00:00:00`
  del giorno atteso): la seconda forma non rifà lo stesso calcolo dell'implementazione.
- **E2E** (`dashboard-stats.e2e-spec.ts`, 11 test, Testcontainers) — dati creati **attraverso l'API**
  (`conti → righe → invia → pagamenti`), non con INSERT diretti, così i KPI sono verificati contro lo
  stato che l'applicazione produce davvero (comande generate da `invia`, importi risolti dal listino).
  Coperti: tenant vuoto → zeri; 4 KPI esatti su dati noti; asporto senza coperti che non sporca la
  somma; `chiudi` che abbassa `contiAperti` ma non `copertiOggi`; `pronta` che esce da
  `comandeInCorso`; storno che esce da `incassoOggi`; split payment; **RBAC con `comande.*`/`cassa.*`
  pieni ma senza `report.operativo.visualizza` → 403** (prova che il gate è quel permesso, non "sei
  autenticato"); isolamento tenant A/B con numeri deliberatamente diversi.

## Impatto

- **`packages/db` / schema Prisma**: **non toccati**. Nessuna migration.
- **Permessi**: **nessuno nuovo**. Nessuna propagazione, nessuna riconciliazione.
- **Altro verticale (accountant)**: **nessun impatto** — la PR tocca solo `apps/restaurant-api`.
- **FE**: nessuno in questa PR. Il contratto è consumato da PR3.

## Roadmap

1. **PR2 (P2)** — `Badge` in `packages/ui` + token `--success`/`--info`/`--destructive-soft`, additivi.
2. **PR3 (P2)** — dashboard FE restaurant che consuma questo endpoint, prima cliente di `Badge` e
   delle KPI card.
3. `TD-dashboard-service-day` — giorno di servizio che scavalca mezzanotte (trigger sopra).
4. `TD-conti-list-amounts` — importi sull'index dei conti; resta aperto, questo endpoint **non** lo
   chiude (aggrega, non espone il per-conto).
