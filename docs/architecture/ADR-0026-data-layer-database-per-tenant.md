# ADR-0026 — Strategia data layer: database-per-tenant abilitabile (schema unico)

- **Status:** Proposed (da promuovere ad Accepted dopo conferma owner)
- **Data:** 2026-06-02
- **Decisori:** Nicolò (owner/arbitro), Claude strategico, Claude Code (ricerca + PoC)
- **Correlati:** ADR-0025 (piattaforma a verticali con core condiviso); ADR-0009 (RLS reale); ADR-0010 (tenant bootstrap); BRIEF §F1 (no astrazione prematura)
- **Base empirica:** ricerca su doc Prisma corrente (2026-06) + PoC isolato eseguito sulle versioni reali (Prisma 6.19.3, generator `prisma-client-js`, Node 20.18.1, 2× Postgres 16). PoC: 4/4 PASS, poi cestinato.

> Questo ADR sostituisce l'ipotesi "split schema multi-file (opzione B)" considerata in fase di analisi: NON è il problema del progetto. Il problema non è separare core da dominio nel file schema, è poter separare i **tenant tra database**.

---

## Contesto

ADR-0025 ha fissato la piattaforma a verticali con core condiviso. È emerso un requisito di prodotto dell'owner: a regime, un singolo tenant (es. uno studio di commercialisti esigente) deve poter avere i propri dati su un **database dedicato, potenzialmente su un altro server**, con isolamento **fisico** e non solo logico — perché si trattano dati fiscali/personali di terzi e un cliente può legittimamente pretendere che i suoi dati non condividano nemmeno le stesse tabelle di altri. In fase test, invece, vale il vincolo budget < 50 €/mese: tutti i tenant su un unico database.

## Decisione

### D1 — Modello: database-per-tenant ABILITABILE, schema + migration unici

- **Un solo schema Prisma e un solo set di migration** (è sempre lo stesso programma per verticale).
- **Default `shared`**: i tenant condividono un database, isolati via RLS (come oggi, ADR-0009). Economico, adatto alla fase test.
- **`dedicated` opt-in per tenant**: un tenant può vivere su un database dedicato (anche su altro server), **senza cambiare schema né codice di dominio** — solo una connection string risolta a runtime.
- I due modelli **coesistono** con lo stesso codice: la RLS via `SET LOCAL` funziona identica sul DB condiviso e sul DB dedicato (verificato in PoC).

### D2 — Meccanismo di connessione: `datasourceUrl` (verificato), non driver adapter

- Si usa `new PrismaClient({ datasourceUrl })` per instradare a runtime verso il database del tenant. **Verificato nel PoC** sulle versioni reali, compatibile con l'estensione RLS esistente, senza nuove dipendenze.
- I **driver adapter** (`@prisma/adapter-pg`) restano un'**opzione futura motivata** (utile solo se serve controllo fine del pool), tenuto conto dei bug aperti su 6.16–6.19 e dell'arrivo di **Prisma 7** (già 7.8.x disponibile) che muove config e generator. Non si adottano ora.

### D3 — Implementazione a due fasi (no over-engineering ora)

- **Fase 1 (ora, fase test):** si introduce **solo l'indirezione** `getClientForTenant(ctx)` che per adesso ritorna sempre l'unico client condiviso. Zero cambi di pooling, rischio minimo, prepara il terreno. È un'aggiunta _additiva_ a `packages/db`, non sposta i modelli di dominio.
- **Fase 2 (quando il primo cliente lo richiede):** si abilita `dedicated` con: client registry + **LRU eviction** + `connection_limit` stretto per pool dedicato; orchestratore migration multi-DB; provisioning DB tenant. Tutto classe STOP.

### D4 — Control plane: mappa tenant → {mode, connString}

- La mappa `tenant → {mode: shared|dedicated, connString, server}` vive in un **catalogo nel database condiviso** (control plane), interrogabile senza già sapere il DB del tenant.
- La **risoluzione del routing-key** avviene dove oggi si popola l'ALS (middleware/JWT, futuro `packages/tenancy`): tenancy risolve il routing-key, `packages/db` lo usa in `getClientForTenant`. **Interfaccia tenancy ↔ db da definire prima di estrarre quei package** (chi possiede la mappa).

#### Addendum 8b-2 (2026-06-05) — attuazione §D3 fase 1: `getClientForTenant` + ownership routing-key

Attuazione di §D3 fase 1 e §D4 (estrazione core ADR-0027 §D5 passo 8b, track 2/2). Non è una decisione nuova: formalizza ciò che §D3/§D4 già prevedevano, con l'evidenza empirica raccolta.

1. **Introdotto** — `getClientForTenant(ctx: TenantContext): ExtendedPrismaClient` in `packages/db` (`src/index.ts`), puramente additivo: in fase 1 ritorna **sempre** il singleton condiviso `prisma`, ignorando `ctx`. Nessun pooling/singleton/extension chain modificato. **Nessun consumer rewirato** — è solo il seam; l'adozione ai call-site è un passo meccanico di fase 2.

2. **Ownership routing-key (decisione §D4 attuata)** — la mappa routing-key (slug→tenant, futuro tenant→`{mode, connString}`) **NON vive in `packages/db`**. Vive nel layer tenancy: oggi i 3 lookup `slug→tenantId` in `@gestionale/auth` (`tenant-consistency.guard.ts`, `tenant.middleware.ts`, `tenants.service.ts`), domani `packages/tenancy`. `packages/db` espone **solo** il consumer (`getClientForTenant`) e riceve un `ctx` già risolto.

3. **Evidenza dirimente (perché non in `db`)** — la mappa _cached_ dipende da Redis (`@gestionale/platform`), e `platform` dipende già da `@gestionale/db`. Far scendere la routing-key cached in `db` creerebbe il ciclo `db ↔ platform`. Inoltre `packages/db` è oggi una **foglia** del grafo (non importa alcun `@gestionale/*`): introdurre l'ownership della mappa lì romperebbe questa proprietà. → la routing-key non appartiene a `packages/db`. (Fatto empirico verificato in preflight 8b STOP 0.)

4. **Confine fase 1 / fase 2** — deferito a fase 2 (estrazione `packages/tenancy` + arrivo del secondo `mode` dedicated-DB): `RoutingKey` tipizzato, catalogo control-plane (`tenant→{mode, connString, server}` nel DB condiviso), evoluzione `DbService.clientFor(ctx)` (§D6). Inventarli ora = build-ahead risk → si applica la disciplina YAGNI del progetto (§F1).

5. **Firma `ctx`** — riusa il `TenantContext` esistente (`{ tenantId: string | null; isSuperAdmin: boolean }`, già ciò che fluisce nell'ALS RLS). **Nessun tipo nuovo** in fase 1.

### D5 — FINDING PRIORITARIO: i test e2e attuali NON esercitano la RLS

Scoperta del PoC, **rischio già presente oggi, indipendente dal database-per-tenant**:

- I test e2e Testcontainers (`test-containers.ts`, `test-app.ts`) si connettono come utente **superuser `postgres`**, sia per migration sia per query runtime. In PostgreSQL il **superuser bypassa la RLS** (FORCE non vale per superuser). Quindi `menu-tenant-isolation.e2e-spec.ts` & co. validano l'isolamento **applicativo**, non l'enforcement **DB-level**. L'unico test che esercita la RLS reale è `smoke:rls-e2e` (gira come `gestionale_app`).
- **Implicazione:** la barriera di isolamento più importante (RLS a livello DB) — che è anche l'argomento di vendita per i commercialisti — oggi ha test verdi che non la testano.
- **Correzione richiesta:** il "test RLS core-only" previsto prima dello split di `packages/db` deve girare come **`gestionale_app` non-superuser**, altrimenti non testa nulla a livello DB. Va inoltre valutato se allineare l'intero gate e2e a girare come app role.

### D6 — Impatto su confine core/dominio e ordine di estrazione (invariati)

- Il data layer **non si splitta, si arricchisce**: il routing per-tenant è additivo a `packages/db`. Confine core/dominio e ordine di estrazione restano quelli concordati nell'analisi pre-estrazione.
- `packages/db` resta l'ultimo e più rischioso step. Vi si aggiungono due sotto-feature (entrambe classe STOP): (i) resolver/registry connessioni, (ii) orchestratore migration multi-DB.
- Nuovo accoppiamento `tenancy ↔ db` (D4) da formalizzare con un'interfaccia prima di estrarre quei package.
- `DbService` evolve da "client fisso" a `clientFor(ctx)` (o request-scoped): refactor DI a valle (tocca i package backend) — da mettere in conto nell'ordine.

## Conseguenze

**Positive**

- Obiettivo di prodotto (isolamento fisico opt-in) raggiungibile senza riscritture: stesso schema/codice, cambia la connessione.
- Il lavoro RLS esistente NON è sprecato: resta l'isolamento per i tenant `shared` e funziona identico sui `dedicated`.
- Fase 1/Fase 2 evita over-engineering: si tiene aperta la porta senza pagarne il costo ora (coerente §F1).
- Scelta `datasourceUrl` verificata empiricamente, non assunta.
- Scoperto e documentato un buco di test reale (D5) che esisteva comunque.

**Costi / rischi / tech debt (da budget)**

- **Pooling:** ogni client dedicato = un pool legato a un DB; impossibile condividere pool tra DB. N tenant dedicati = N pool → serve registry + LRU + `connection_limit` stretto (rischio esaurimento connessioni).
- **PgBouncer ↔ SET LOCAL:** la RLS per-operazione è incompatibile con pooler in transaction mode → solo session mode, oppure decidere se rilassare la RLS sui DB dedicati monotenant (isolamento fisico già garantito) accettando divergenza di code-path. Trade-off da decidere in fase 2.
- **App role cluster-global:** `gestionale_app` è condiviso per cluster; le migration `CREATE ROLE`/GRANT/RLS vanno rese **idempotenti** nel provisioning di un nuovo DB.
- **Nessun "migrate-all" nativo:** orchestratore custom (loop `migrate deploy` con URL per tenant) + drift detection per-DB da mantenere.
- **Multi-server reale:** gestione segreti per N connection string, latenza, backup/restore per-tenant → è materia **infra**, fuori da Prisma, da trattare a parte in fase 2.
- **DI refactor** (`DbService` → request-aware) a valle.

## Alternative considerate

- **Split schema multi-file ("opzione B"):** irrilevante per l'obiettivo (separa core/dominio nel file, non i tenant tra DB). Scartata.
- **Due schemi/due client (per verticale):** astrazione prematura sul data layer, duplica entità core o rompe FK. Rimandata a quando esisterà un secondo schema reale.
- **Driver adapter ora:** cambio più invasivo, bug aperti su 6.16–6.19, Prisma 7 in arrivo. Rimandato (D2).

## Follow-up

- [~] Definire l'interfaccia `tenancy ↔ db` (chi possiede la mappa tenant→DB) prima di estrarre quei package. — _ownership decisa in 8b-2 (mappa in tenancy/`@gestionale/auth`, `db` la consuma via `getClientForTenant`); il tipo `RoutingKey` e il catalogo control-plane restano deferiti a fase 2 (Addendum sotto §D4)._
- [ ] Riscrivere/aggiungere il **test RLS core-only come `gestionale_app` non-superuser** (prerequisito dello step `packages/db`); valutare allineamento dell'intero gate e2e all'app role (D5).
- [x] Fase 1: introdurre l'indirezione `getClientForTenant` (ritorna il client condiviso) come step additivo. — _fatto in 8b-2 (2026-06-05), vedi Addendum sotto §D4._
- [ ] Fase 2 (a richiesta cliente): registry+LRU, orchestratore migration multi-DB, provisioning idempotente, decisione PgBouncer/RLS.
