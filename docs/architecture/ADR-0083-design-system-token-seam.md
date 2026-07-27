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
