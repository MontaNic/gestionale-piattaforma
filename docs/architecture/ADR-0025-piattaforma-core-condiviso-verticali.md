# ADR-0025 — Da "gestionale ristorazione" a piattaforma a verticali con core condiviso

> Numero assegnato: **0025** (l'ultimo presente era ADR-0024).

- **Status:** Proposed (da promuovere ad Accepted dopo conferma owner)
- **Data:** 2026-06-01
- **Decisori:** Nicolò (owner/arbitro), Claude strategico
- **Supersedes:** imposta lo scope del progetto definito in `PROJECT_BRIEF.md` §A1 ("modulo unico ristorazione in F1-F3")
- **Correlati:** §F1 brief (retail come app separata che riusa i singleton condivisi) — questo ADR generalizza quel principio.

---

## Contesto

Il progetto era nato come **gestionale per la ristorazione** (vedi `PROJECT_BRIEF.md`), arrivato alla **sessione 21** con le fondamenta pronte e testate (monorepo, CI/CD, auth, multi-tenant + RLS attiva, RBAC con defense-in-depth cross-tenant, tenant bootstrap, login UI, i18n, shell con 8 nav placeholder; 48 unit + 13 e2e + 9 Playwright). I **moduli di dominio** (menu, comande, cassa, KDS, magazzino…) **non sono ancora stati costruiti**: il prossimo task era il primo CRUD del menu.

In parallelo esiste un **secondo progetto**, un portale per **studi commercialisti / consulenti del lavoro** ("StudioDesk"), sviluppato in **PHP + MySQL senza framework**. È molto maturo a livello di dominio (~60 migration: scadenzario fiscale, DMS con versioning e firma OTP, comunicazioni multicanale, billing, agevolazioni, questionari, ecc.) ma è cresciuto in modo **non lineare**, con incoerenze tra parti modificate separatamente — problema di architettura/coesione, non di linguaggio.

L'owner ha chiarito due punti:

1. La ristorazione **non interessa più come prodotto**: era un test.
2. Serve una **base solida e riutilizzabile** da cui costruire diversi verticali futuri.
3. Lo status "andrà in produzione/da vendere" è **non ancora deciso**: prima fase di test, poi valutazione.

## Decisione

1. **La ristorazione cessa di essere il prodotto-obiettivo.** Viene ridefinita come **starter kit / boilerplate** interno: la base tecnica da cui derivare ogni verticale.

2. **Si estrae ORA un core tecnico/infrastrutturale condiviso**, agnostico al dominio, nei `packages/` del monorepo. Include: autenticazione (+ MFA), multi-tenant resolver + **RLS PostgreSQL**, RBAC + guard cross-tenant, audit log, i18n, design system (`packages/ui`), tipi/validatori condivisi (`packages/shared`), setup infra (Docker/Compose, Caddy), CI/CD. Questo è il pezzo difficile e rischioso **già costruito e testato** nella ristorazione.

3. **NON si estrae ora il core di dominio** (anagrafica, fatturazione, fidelity, magazzino "generalizzati"). Generalizzare il dominio senza un secondo verticale reale davanti è **astrazione prematura** — esattamente ciò che il brief §F1 vieta. Il core di dominio si estrarrà **dopo**, osservando cosa è davvero comune tra i verticali reali, non indovinandolo.

4. **Ogni verticale è un'app separata nel monorepo** (`apps/<verticale>`) che **consuma i package condivisi**, coerente con la decisione già presa nel brief §F1. Niente verticali infilati dentro un'altra app.

5. **Primo verticale reale = commercialisti**, costruito in **TypeScript** sulla base condivisa, **riusando la conoscenza e il modello dati** del portale PHP StudioDesk (non il codice PHP). Il portale PHP **resta in beta/funzionante** finché il nuovo verticale non lo sostituisce.

6. **Politica "build as if real"**: architettura e sicurezza si fanno fin da subito a livello di prodotto reale (già lo standard del progetto). Si rimandano al momento del go-live **solo** le validazioni legali esterne (commercialista/RT, consulente privacy GDPR, consulente del lavoro, pentest professionale — brief §E). **Nessuna scorciatoia architetturale** giustificata dal "tanto è un test".

## Conseguenze

**Positive**

- Si riusa il lavoro più difficile e rischioso (core multi-tenant sicuro) invece di riscriverlo: niente rewrite-from-scratch dei commercialisti.
- Timing ideale: la ristorazione è ferma a foundation+shell, _prima_ dei moduli di dominio → l'estrazione del core è pulita, senza codice di business ristorazione da districare.
- Il problema di incoerenza del vecchio PHP è risolto alla radice: la base TS è modulare e coerente per design.
- Base unica e testata per N verticali futuri.

**Costi / negative**

- Lavoro di estrazione/refactor della foundation ristorazione in `packages/` riusabili (con relativi test di non-regressione).
- I moduli di dominio ristorazione **non verranno sviluppati**: restano allo stato di scaffold/placeholder (accettato: la ristorazione non è più un prodotto).
- Rischio di "scope creep" verso un framework generico: va contenuto (vedi sotto).

**Rischi e mitigazioni**

- _Astrazione prematura del dominio_ → mitigata dalla regola "due casi reali prima di astrarre" (§F1 brief): per ora si astrae **solo** il tecnico.
- _Divergenza tra core e bisogni del verticale_ → mitigata mantenendo il core **minimale** ora ed estraendolo per incrementi quando emerge il bisogno reale.
- _Tensione test vs produzione_ → mitigata dalla politica "build as if real": l'architettura non cambia, cambiano solo le validazioni legali finali.

## Alternative considerate

- **A. Due progetti separati, nessun core condiviso.** Scartata: duplicheresti l'infrastruttura (auth, multi-tenant, RLS, CI) per ogni verticale.
- **B. Generalizzare anche il dominio ora (POS/anagrafica/fatturazione "universali").** Scartata: astrazione prematura, vietata dal brief §F1.
- **C. Riscrivere i commercialisti in TS da zero, senza la base ristorazione.** Scartata: butteresti fondamenta già costruite e testate.
- **D. Tenere i commercialisti in PHP + framework (Laravel/Symfony).** Era un'opzione valida quando il confronto era "PHP vs riscrittura da zero". Scartata ora perché esiste già una base TS testata che fornisce la stessa coerenza strutturale **e** un core riusabile per più verticali.

## Follow-up

- [ ] Definire l'elenco preciso di package/funzioni da estrarre nel core (e cosa scartare). _(prossimo task)_
- [ ] Aggiornare `PROJECT_BRIEF.md` §A1/§A5 e `PROGRESS.md` (vedi changeset allegato).
- [ ] Pianificare l'ingest del modello dati StudioDesk come requisiti del verticale commercialisti.
