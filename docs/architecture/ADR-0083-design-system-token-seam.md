# ADR-0083 — Design system: architettura a token e seam per-verticale

- **Stato**: Accettato
- **Data**: 2026-07-27
- **Contesto PR**: PR1 dell'iniziativa di restyling (multi-PR). Fasi P2–P4 nominate qui, speccate al proprio turno.
- **Cross-ref**: estende [ADR-0061](ADR-0061-branding-per-verticale-build-time.md) (branding per-verticale, deliberatamente color-free) · [ADR-0018](ADR-0018-f1-shell-ui-foundation.md) (dark mode) · [ADR-0027](ADR-0027-composizione-core-condiviso.md) §D5 (estrazione `packages/ui`)

## Contesto

Il design system condiviso (`packages/ui`) è nato agnostico rispetto al colore: ADR-0061 ha dichiarato esplicitamente
"NIENTE colori: la palette resta nei `globals.css` per-app". Quella scelta era corretta per il branding
(wordmark, nome prodotto, favicon), ma ha lasciato tre problemi aperti:

1. **Duplicazione senza seam.** Le due `tailwind.config.ts` erano **byte-identiche** (`TD-tailwind-config-dup`) e i due
   `globals.css` differivano per 3 variabili — `--primary`, `--primary-foreground`, `--ring` — ma nulla nel codice
   diceva _quali_ fossero il punto di divergenza voluto e quali invece una copia da tenere allineata a mano.
   ⚠️ La divergenza è in **entrambi** i temi, non solo in light: la ricognizione iniziale aveva letto il blocco
   `.dark` come identico fra le due app, e non lo è. Il seam preesistente era quindi **3 variabili × 2 temi**.
   Il numero corretto viene dal diff contro il build reale (§Verifica), non dall'ispezione a vista.
2. **Letterali nei componenti.** Lo stato attivo della Sidebar accountant usava `bg-blue-100 … dark:bg-blue-900/30`
   hardcoded: un colore che non passa da nessun token e che quindi nessun cambio di tema può raggiungere.
3. **Drift tipografico non dichiarato.** accountant caricava Inter via `next/font`, restaurant ereditava il font di
   sistema. Non era una decisione: era una differenza mai notata.

Serve inoltre decidere _ora_ dove andrà il branding per-tenant (un singolo studio/ristorante che chiede i propri
colori), per non doverci tornare riscrivendo i componenti.

## Decisione

### 1. Le quattro leggi del design system

Valgono come **checklist di review per ogni PR visiva**:

1. **Zero letterali nei componenti.** Ogni colore/radius/spacing passa da un token semantico. Nessun hex, nessun
   `bg-blue-100`, nessun valore fisso in `packages/ui` o nei componenti app. È ciò che rende il per-tenant futuro
   un semplice swap di valori.
2. **Accento riservato al significato.** `--primary`/`--accent` solo per denaro e azioni terminali; mai come
   riempimento decorativo.
3. **Mai contrasto massimo.** `--foreground` ≠ `#000`, `--background` ≠ `#fff`. La regola vale sui token base:
   l'obiettivo è riposante a 4 ore, non solo leggibile a 5 secondi.
4. **Due temi sempre.** Ogni token ha la sua controparte `.dark`; l'accento in dark va a **chroma ridotta**.

### 2. Assegnazione estetica (calibrata per superficie, non un'estetica unica)

- **A · Servizio** — sistema di base (neutri, tipografia, spaziatura, radii, accento operativo). È la superficie dove
  si vive per ore → **bassa personalità voluta**.
- **C · Turno** — variante **dark**, default per il KDS e opzionale ovunque a un tap. Accento a chroma ridotta,
  vicino al testo.
- **B · Sala** — **layer di brand** food (login, colore-verticale, prime impressioni). **Non** diventa l'accento
  di tutti i giorni: è per questo che `--brand` è un token distinto da `--primary`.

### 3. I tre livelli di cascata

| Livello                     | Dove vive                                  | Cosa contiene                                                                                                            |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Condiviso**               | `packages/ui/src/tokens.css`               | neutri, superfici, tipografia, radii, token additivi, regole base `*`/`body`                                             |
| **Per-verticale** (il seam) | blocco in `apps/<app>/src/app/globals.css` | `--primary`/`--primary-foreground`, `--ring`, `--accent-soft`/`--accent-soft-foreground`, `--brand`/`--brand-foreground` |
| **Per-tenant**              | **previsto, oggi vuoto**                   | override runtime di `--primary`/`--brand` per sottodominio                                                               |

Il livello per-tenant **non si costruisce ora** (YAGNI). È documentato come seam previsto perché la legge #1 lo rende
realizzabile senza toccare un solo componente. **Trigger**: un tenant chiede branding proprio.

Il mapping nome-Tailwind → token vive una volta sola in `packages/ui/tailwind-preset.ts`. Le app conservano la propria
`tailwind.config.ts` solo per ciò che è genuinamente per-app: `content` (glob diversi) e `plugins`.

### 4. Estensione di ADR-0061

ADR-0061 resta valido su tutto ciò che riguarda il **brand object** (`productName`, `Logo`, `favicon`): quello è
build-time e non passa dai token. Cambia una cosa sola: il **colore-brand** ora **entra** nel design system come token
`--brand`/`--brand-foreground`, invece di restare implicito dentro `--primary`. Il "NIENTE colori" di ADR-0061 va
riletto come "niente colori _nel brand object TypeScript_" — la palette continua a non passare da lì.

### 5. Tipografia

`--font-sans` è **condiviso** e punta a `--font-inter`, la CSS variable prodotta da `next/font` nel layout root di
ciascuna app. Restaurant carica ora Inter come già faceva accountant: **chiusura di un drift, non una scelta estetica
nuova**. `--font-display` è additivo e oggi alias di `--font-sans`; la scala tipografica esplicita è estetica e arriva
in P3, non in questo ADR.

## Perimetro di PR1 (cosa NON fa)

Nessun cambio di neutri/scala/spaziatura, nessun ritocco alle 12 primitive esistenti, nessuna primitiva nuova, nessun
rebuild di pagine. PR1 costruisce **solo il meccanismo**. L'estetica A/C/B si applica in P2–P4 _attraverso_ questo seam:

- **P2** — primitive nuove **additive** (badge, table, select, toast: rischio zero finché non adottate) + rebuild della
  dashboard restaurant (per-app, blast radius zero).
- **P3** — applicazione dell'estetica A a shell e pagine restaurant attraverso il seam.
- **P4** — ritocco delle 12 primitive condivise. **Unica fase non isolabile** (79 file, 2 app) → ultima, isolata, con
  baseline screenshot come _strumento di iterazione_.

## Verifica

Non esiste rete di visual regression (`TD-visual-regression-net`), quindi l'invarianza è stata dimostrata
**strutturalmente sull'artefatto reale**, non a occhio:

1. **Diff del CSS emesso da `next build`**, baseline (`bc36e7d`) vs PR, per entrambe le app: estratto il valore finale
   di ogni custom property dopo la cascata, in `:root` e `.dark`. Risultato: **diff puramente additivo** — zero
   dichiarazioni modificate, zero rimosse. Accountant +13 token nuovi, restaurant +14 (di cui `--font-sans`, il fix
   tipografico dichiarato).
2. **Nessuna classe purgata**: il `content` scansiona `packages/ui`; ogni regola presente nel CSS baseline esiste
   identica nel nuovo output.
3. **Colori computati a runtime** (Chromium, dev stack su DB dev, ruolo non-superuser `collaboratore@studio.local`),
   stato attivo Sidebar accountant:

   |            | letterale sostituito   | token, misurato          |
   | ---------- | ---------------------- | ------------------------ |
   | light bg   | `blue-100` = `#dbeafe` | `rgb(219, 234, 254)`     |
   | light text | `blue-900` = `#1e3a8a` | `rgb(30, 58, 138)`       |
   | dark bg    | `blue-900/30`          | `rgba(30, 58, 138, 0.3)` |
   | dark text  | `blue-100`             | `rgb(219, 234, 254)`     |

   La conversione hex→HSL usata nei token è **esatta al roundtrip** su entrambi i valori: la resa è pixel-identica.

## Conseguenze

**Positive** — il punto di divergenza fra i due verticali è ora esplicito e circoscritto: **7 variabili × 2 temi**
(le 3 preesistenti + `--accent-soft`/`--accent-soft-foreground` e `--brand`/`--brand-foreground` introdotte qui).
Il tema è definito una volta; il per-tenant è raggiungibile senza toccare componenti; `TD-tailwind-config-dup` è
risolto.

**Negative / accettate**

- **`postcss-import` aggiunto a entrambe le app.** Next processa un `@import` di CSS da package come **modulo
  separato**, girandoci sopra Tailwind senza `@tailwind base` (→ ``@layer base` is used but no matching `@tailwind
base` directive is present``). `postcss-import` lo inlinea prima di `tailwindcss`, che è anche la semantica della
  CLI usata per il diff di invarianza. Costo: 6 righe di lockfile, nessun pacchetto nuovo nello store.
- **`tailwind-preset.ts` non è typecheckato.** Tipizzarlo con `Config` richiederebbe `tailwindcss` fra le dipendenze di
  `packages/ui`, che trascina `jiti` e ri-risolve il peer graph: ~230 righe di churn nel lockfile per un import di solo
  tipo. Stessa convenzione dei `tailwind.config.ts` per-app, già oggi fuori dal `include` dei rispettivi tsconfig. La
  rete di sicurezza reale è il diff del CSS generato (§Verifica).
- **Le regole base `*`/`body` restano in `tokens.css`** e quindi dipendono dall'ordine: il file va importato **prima**
  delle direttive `@tailwind`, così le sue regole finiscono nel base layer dopo il preflight. Invertire l'import
  cambierebbe il colore dei bordi di default.
- **Il resto dei letterali colore non è stato toccato.** PR1 fixa solo la Sidebar accountant. Restano ~13 occorrenze
  (`bg-blue-100`, `#3b82f6`, …) in componenti note-spese, preventivi, mandati, KDS: si estinguono in P3/P4, quando la
  primitiva `badge` che li sostituisce esisterà.

## Debito registrato

- 🆕 **`TD-visual-regression-net`** — baseline Playwright su `page-manifest` × light/dark. **Trigger**: prima di P4
  (ritocco delle primitive condivise). Nasce come **strumento di iterazione, NON come gate**, dato lo stato pre-lancio
  senza clienti reali.

  **Il debito è già coperto a metà, gratis.** Il diff dei valori computati usato in §Verifica è il cugino economico
  della rete screenshot per tutto ciò che è **cambio di token**: deterministico, nessuna baseline binaria da
  mantenere, nessun flake da rendering. Va **riusato prima di P4** e la rete screenshot va costruita solo per il
  residuo che questo diff non vede — geometria, spaziatura, ritorni a capo, cioè esattamente ciò che il ritocco delle
  primitive tocca. Ricetta: worktree della baseline → `next build` su entrambi → estrarre il valore finale di ogni
  custom property dopo la cascata in `:root`/`.dark` dal CSS emesso → il diff deve essere puramente additivo.

- 🆕 **`TD-smoke-punta-solo-a-prod`** — `page-tour.spec.ts` ha `baseURL` sull'URL **pubblico** (`studiodesk.cloud`) in
  entrambe le app, quindi **non può validare un branch prima del merge**: eseguirlo su una PR misura la produzione,
  non la PR. In PR1 il sostituto è stato la verifica runtime su stack dev buildato dal branch. È un **limite
  dell'infrastruttura di test**, non di una singola PR. **Trigger**: quando serve una smoke per-ruolo gatante in CI
  su codice non ancora deployato — allora il `baseURL` va parametrizzato su un'istanza effimera costruita dal branch.
- ✅ **`TD-tailwind-config-dup`** — risolto da questa PR.

---

## Emendamento 2026-08-24 — A è il sistema di base, non una skin del restaurant

- **Stato**: Accettato
- **Contesto PR**: PR0 dell'iniziativa (promozione di `StatCard` a `packages/ui`). L'emendamento sta qui e non in un
  documento separato perché, sotto il §Perimetro originale, PR0 sarebbe classificata P4 («unica fase non isolabile»):
  correggere la classificazione fa parte del giustificare PR0.

### Cosa era sbagliato

Il §Perimetro dice due cose che **non compongono** con §2:

> **P3** — applicazione dell'estetica A a shell e pagine restaurant attraverso il seam.
> **P4** — ritocco delle 12 primitive condivise. **Unica fase non isolabile**.

§2 definisce A come «sistema di base (neutri, tipografia, spaziatura, radii, accento operativo)». Di quelle cinque
categorie, **neutri, tipografia e radii vivono nel file condiviso** (`tokens.css`), non nel seam. Il seam è 7 variabili,
tutte di accento e brand: non può portare A. Quindi:

- **A non è una skin del restaurant: è la fondazione condivisa.** Applicarla tocca **anche l'accountant**, per
  costruzione, non per effetto collaterale.
- **P3 non è isolabile**, e **P4 non è «l'unica» fase non isolabile.**

### La prova che regge la riclassificazione

È il §5 di questo stesso ADR: «la scala tipografica esplicita è estetica e arriva in **P3**». La scala tipografica
**non ha una casa per-verticale** — `tailwind-preset.ts` la rifiuta esplicitamente («NON entra qui: è estetica, non
seam») e il seam non ha variabili tipografiche. Non esiste un terzo posto. Se la scala arriva in P3 e l'unico posto
dove può stare è il condiviso, allora P3 tocca il condiviso. La contraddizione era già scritta qui dentro.

### L'inganno di naming

`A · Servizio`, `B · Sala`, `C · Turno` sono parole del **dominio ristorante** che nominano, in due casi su tre,
fondazione **condivisa**. Il nome ha suggerito "superficie del restaurant", e la formula in `HANDOFF.md` («vernice A su
tutto il restaurant») ha cristallizzato la lettura sbagliata al punto da farla sopravvivere a due sessioni.

Stessa famiglia di `docker-compose.dev.yml`, che è in realtà il file base: **il nome mente e nessuno rilegge il
contenuto.** Il presidio non è ricordarsi, è che il nome e il contenuto vengano riletti insieme quando si pianifica.

### Il nuovo ordine

| fase      | cosa                                                                                 | blast radius            |
| --------- | ------------------------------------------------------------------------------------ | ----------------------- |
| **PR0**   | promozione `StatCard` a `packages/ui` (questa PR)                                    | `packages/ui` + 2 app   |
| **P3a**   | seam restaurant: accento e brand food, `--accent-soft`, `--ring` **+ adozione**      | restaurant only         |
| **P3b-0** | estinzione dei 94 letterali colore accountant via `Badge` + token di stato           | accountant only         |
| **P3b**   | sistema di base: neutri, radii, scala tipografica (condivisi) + spaziatura (per-app) | **entrambi, 46 pagine** |

**P3b-0 è prerequisito bloccante di P3b**, non lavoro parallelo — ADR-0085 §Roadmap è corretto di conseguenza. Motivo:
un letterale è _per definizione_ ciò che nessun cambio di token raggiunge (è la legge #1 detta al contrario). Toccare i
neutri con 94 letterali ancora in piedi lascerebbe 94 punti fermi mentre tutto il resto si muove — difetto **garantito
a priori**, non rischio non coperto, e per giunta nell'app più grande (67 file, 32 pagine contro 34 e 14) e senza
copertura e2e pre-merge (`TD-smoke-punta-solo-a-prod`).

Due rettifiche di portata emerse dalla misura, che il palinsesto non nominava:

1. **P3a non è uno swap di valori.** `--brand` e `--accent-soft` hanno **zero consumer** in `restaurant-web`: cambiarne
   il valore oggi non dipinge nulla. P3a è swap **+ adozione** (login per il brand, voce di nav attiva per la tinta
   soffusa). È markup, quindi il diff dei custom property non lo copre da solo.
2. **P3b non è omogeneo.** La **spaziatura non ha token**: vive nelle utility dei call-site, quindi è restaurant-local
   e non tocca l'accountant. Neutri, radii e scala tipografica sì.

### `packages/ui` non è più framework-agnostico

`stat-card.tsx` importa `next/link` e **`next` entra come peer + dev dependency** del package. È il primo import di
Next in `@gestionale/ui`; il precedente nel monorepo esiste già (`@gestionale/auth-web`, `@gestionale/i18n`, stessa
forma peer + dev).

Due ragioni, e la seconda pesa più della prima:

1. L'agnosticismo era una proprietà **senza consumer**: entrambe le app sono Next 15 e nessun altro pacchetto importa
   `@gestionale/ui`. Preservarla al costo di un rischio di resa reale è il contrario di YAGNI.
2. L'alternativa — iniettare il link dal chiamante come `ReactNode` — **rimette markup nei call-site**. Ma il motivo per
   cui `StatCard` viene promossa è che `KpiCard` era nata gemella e divergente: una primitiva che delega parte del
   proprio markup a chi la chiama riproduce esattamente quell'esito fra sei mesi. Si sarebbe pagato in divergenza il
   prezzo di un aggettivo.

**Trigger per riconsiderare**: la comparsa di un consumer non-Next di `@gestionale/ui`. Allora la forma giusta è il link
iniettato, e va pagata con la disciplina di tenere allineati i call-site.

Costo misurato: **3 righe di lockfile** (`next` 15.5.18 era già nello store, risolto dalle app).

### Fuori legge #1, e dichiarato

Il restaurant chiude P3 con `kds/page.tsx` **ancora fuori dalla legge #1**: i 16 letterali di `statoBadgeClass()` sono
estetica **C · Turno** e restano lì finché C non ha il suo turno. Non è una dimenticanza da scoprire in review.
