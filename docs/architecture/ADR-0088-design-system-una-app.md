# ADR-0088 — Design system a un'app sola: le leggi restano, il palinsesto A/B/C decade

- **Stato**: Accettato
- **Data**: 2026-09-01
- **Supersede**: [ADR-0083](ADR-0083-design-system-token-seam.md) (architettura a token e seam per-verticale), emendamento del 2026-08-24 incluso
- **Contesto PR**: PR3 della sequenza di rimozione del verticale restaurant (PR1 → … → PR6)
- **Cross-ref**: [ADR-0061](ADR-0061-branding-per-verticale-build-time.md) (brand object, color-free) · [ADR-0085](ADR-0085-token-stati-badge.md) (token di stato) · [ADR-0087](ADR-0087-gate-cross-workspace-invisibile-alla-cache.md) (il gate di contrasto e la cache)

---

## Contesto

ADR-0083 ha costruito un design system attorno a un **seam per-verticale**: il punto in cui due prodotti — un gestionale per la ristorazione e uno per studi professionali — dovevano poter divergere restando sulla stessa fondazione. Rimosso il verticale restaurant, quel seam ha **una sponda sola**.

Non è una svalutazione dell'ADR: il meccanismo ha funzionato, e la misura di PR1 lo dimostra — la divergenza era esattamente 7 variabili × 2 temi, circoscritta e leggibile. È il **contesto** che è cambiato, e con esso una parte del vocabolario.

Restava anche un residuo concreto: il gate di contrasto pinnava una coppia `seam restaurant` con `usi: []` e attesi `16.3 / 13.95` su un foglio di token che non esiste più. Da PR2 `main` era rosso lì.

## Decisione

### 1. Le quattro leggi restano, integralmente

Sono la parte dell'ADR-0083 che non dipende da quanti verticali esistono. Valgono come **checklist di review per ogni PR visiva**:

1. **Zero letterali nei componenti.** Ogni colore/radius/spacing passa da un token semantico. Nessun hex, nessun `bg-blue-100`, nessun valore fisso in `packages/ui` o nei componenti app. È ciò che rende il per-tenant futuro un semplice swap di valori.
2. **Accento riservato al significato.** `--primary`/`--accent` solo per denaro e azioni terminali; mai come riempimento decorativo.
3. **Mai contrasto massimo.** `--foreground` ≠ `#000`, `--background` ≠ `#fff`. La regola vale sui token base: l'obiettivo è riposante a 4 ore, non solo leggibile a 5 secondi.
4. **Due temi sempre.** Ogni token ha la sua controparte `.dark`; l'accento in dark va a **chroma ridotta**.

La legge #1 è quella che porta il peso: è la ragione per cui il livello per-tenant è realizzabile senza toccare un componente, ed è la sola che il codice verifica da sé (il censimento in `contrast.test.ts`).

### 2. Due livelli, più uno previsto e vuoto

| Livello        | Dove vive                                  | Cosa contiene                                                                                                            |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Condiviso**  | `packages/ui/src/tokens.css`               | neutri, superfici, tipografia, radii, token additivi, regole base `*`/`body`                                             |
| **Per-app**    | blocco in `apps/<app>/src/app/globals.css` | `--primary`/`--primary-foreground`, `--ring`, `--accent-soft`/`--accent-soft-foreground`, `--brand`/`--brand-foreground` |
| **Per-tenant** | **previsto, oggi vuoto**                   | override runtime di `--primary`/`--brand` per sottodominio                                                               |

**Il livello intermedio resta, rinominato da «seam per-verticale» a «livello per-app».** Con una sola app non separa più due prodotti — ma è il meccanismo su cui si innesta il per-tenant, che è l'unica ragione superstite per cui la legge #1 vale ancora. Collassarlo in `tokens.css` oggi significherebbe ricostruirlo al primo tenant che chiede il proprio branding: si risparmierebbe un'indirezione e si perderebbe la struttura.

**Trigger del per-tenant invariato**: un tenant chiede branding proprio. **Nessun valore cambia con questo ADR**: gli 8 token restano dove sono, con i valori che hanno.

Cambia però la **domanda che fa da guardia** al livello, e non è un dettaglio di forma: era «i due verticali devono differire?», ora è «questo token è dell'app o è del sistema?». La prima domanda si rispondeva da sé guardando l'altro verticale; la seconda richiede di decidere. I commenti in `tokens.css` e `globals.css` sono riscritti su questa domanda perché sono la sola documentazione in-linea di dove va messo un token nuovo.

### 3. Il palinsesto A/B/C decade

`A · Servizio`, `B · Sala`, `C · Turno` erano **definiti dal dominio food**:

- **C · Turno** era il KDS — la board da leggere da lontano, dark per default. Il KDS è rimosso con il verticale.
- **B · Sala** era il layer di brand food (login, colore-verticale, prime impressioni). Non esiste più il brand che nominava.
- **A · Servizio** sopravvive, ma non come una delle tre: l'emendamento del 24/08 lo aveva **già riclassificato come sistema di base** — neutri, tipografia, spaziatura, radii, accento operativo — cioè come fondazione condivisa, non come skin di un verticale.

Con un'app sola la distinzione A/B/C **non ha più oggetto**: resta la fondazione, e non c'è nulla da cui distinguerla. Le tre etichette escono dal vocabolario del progetto.

### 4. L'inganno di naming, portato qui perché sopravvive al palinsesto

L'emendamento del 24/08 aveva registrato che `A · Servizio`, `B · Sala`, `C · Turno` sono **parole del dominio ristorante** che nominavano, in due casi su tre, fondazione **condivisa**. Il nome ha suggerito «superficie del restaurant», e la formula in `HANDOFF.md` («vernice A su tutto il restaurant») ha cristallizzato la lettura sbagliata al punto da farla sopravvivere a due sessioni.

Va riportato qui, e non lasciato in un ADR superseduto, perché **la lezione non riguarda il palinsesto che decade**: riguarda il fatto che un nome preso dal dominio di un consumer descrive male ciò che è condiviso. Stessa famiglia di `docker-compose.dev.yml`, che è in realtà il file base, e — più recente — di `image: gestionale/accountant-api` senza tag, dove `:latest` sembra un alias e invece è l'unica ancora ([ADR-0086](ADR-0086-rollback-point-coppia-bloccante.md)). Il presidio non è ricordarsi: è che **il nome e il contenuto vengano riletti insieme quando si pianifica**.

La rinomina «seam per-verticale» → «livello per-app» di questo ADR è l'applicazione della stessa lezione a sé stessa.

### 5. Il gate di contrasto perde una coppia, non una regola

La coppia `seam restaurant · tinta soffusa dell'accento (nessun consumer)` esce da `PAIRS`. Nessuna soglia toccata, nessun valore, nessun altro pin: 41 asserzioni verdi contro le 43 di prima (le 2 in meno sono quelle della coppia).

Il test **`ogni app trovata su disco ha una coppia per-app dichiarata`** — che è il verso opposto, e il presidio che conta — resta e continua a valere: `appNames()` scopre le app dal filesystem (`apps/*/src/app/globals.css`) e lancia solo a zero. Con `accountant-web` unica app, restituisce `["accountant-web"]` senza casi speciali, e la coppia dichiarata è la sua.

## Roadmap aggiornata

| fase      | stato                     | cosa                                                                              |
| --------- | ------------------------- | --------------------------------------------------------------------------------- |
| **PR0**   | ✅ fatta                  | promozione `StatCard` a `packages/ui`                                             |
| **P3a**   | ❌ **decade interamente** | era «seam restaurant: accento e brand food, `--accent-soft`, `--ring` + adozione» |
| **P3b-0** | ✅ fatta                  | estinzione dei letterali colore accountant via `Badge` + token di stato           |
| **P3b**   | 🔜 prossima               | sistema di base: neutri, radii, scala tipografica (condivisi) — **32 pagine**     |

Due rettifiche di portata:

1. **P3a decade interamente.** Era la palette food e la sua adozione: non c'è più né la palette né l'app che la adottava.
2. **P3b passa da 46 a 32 pagine.** L'emendamento del 24/08 aveva già misurato che P3b non è omogeneo: la **spaziatura non ha token**, vive nelle utility dei call-site, ed era quindi restaurant-local. Rimosso il verticale, quella parte non esiste più e P3b resta neutri, radii e scala tipografica — tutti condivisi — sulle 32 pagine dell'accountant.

## Conseguenze

**Positive**

- Il vocabolario torna a descrivere il codice: non esiste più un «altro verticale» da cui divergere, e i commenti non lo promettono più.
- Il rosso di `main`, aperto di proposito da PR2, si chiude qui.
- La roadmap perde una fase intera senza perdere lavoro: P3a non era stata iniziata.

**Costi accettati**

- **Un'indirezione conservata senza consumer attuale.** Il livello per-app oggi ha una sola sponda: è una struttura che serve a un futuro (il per-tenant) e non al presente. È lo stesso YAGNI che l'ADR-0083 aveva accettato per il terzo livello, applicato al secondo.
- **Un ADR superseduto anziché emendato.** ADR-0083 resta leggibile come storia, ma chi cerca «il design system» deve arrivare qui: il rimando in testa a ADR-0083 è ciò che lo garantisce.
- **La misura di invarianza resta strutturale**, non visiva: `TD-visual-regression-net` è ancora aperto, e la prova di questa PR è il CSS emesso byte-identico prima e dopo.

## Debito

- **`TD-visual-regression-net`**, **`TD-smoke-punta-solo-a-prod`**: ereditati da ADR-0083, invariati.
- **`TD-turbo-cache-gate-cross-workspace`** ([ADR-0087](ADR-0087-gate-cross-workspace-invisibile-alla-cache.md)): il gate di contrasto legge fuori dal proprio workspace, quindi la verifica locale di ogni PR che tocca i fogli di token va fatta con `turbo run test --force`.
- 🆕 **`TD-badge-size-lg-senza-consumer`** — tier BASSO. `size="lg"` di `Badge` è nato per il KDS ed è oggi senza call-site applicativo: l'unico riferimento è la smoke test della primitiva. Non rimosso qui (questa PR non cambia l'API delle primitive), ma è una variante che si giustifica solo se qualcosa tornerà a leggersi da lontano. **Trigger**: la prossima revisione delle primitive (ex P4).

## Fuori scope

- P3b: neutri, radius, scala tipografica.
- Qualsiasi cambio di valore: questa PR non ridipinge nulla.
