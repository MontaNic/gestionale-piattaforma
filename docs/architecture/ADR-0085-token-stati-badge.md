# ADR-0085 — Token semantici di stato + primitiva `Badge`

- **Stato**: Accettato
- **Data**: 2026-07-28
- **Contesto PR**: PR2 della fase **P2** dell'iniziativa di restyling. PR1 = [ADR-0084](ADR-0084-dashboard-stats-food.md) (endpoint `/dashboard/stats`), PR3 = dashboard FE, prima cliente di questa primitiva.
- **Cross-ref**: applica [ADR-0083](ADR-0083-design-system-token-seam.md) (le 4 leggi, il seam, `--warn` posato e non consumato) · [ADR-0027](ADR-0027-composizione-core-condiviso.md) §D5 (`packages/ui`)
- **Slice**: `packages/ui` only — **additivo puro**, nessun call-site adottato

## Contesto

ADR-0083 ha posato `--warn`/`--warn-soft` come token additivi "non ancora adottati", e ha fissato la
legge #1: **zero letterali nei componenti**. Il resto del vocabolario di stato è però rimasto
letterale e sparso:

- **24+ `<span>` pastiglia** inline nei due verticali, tutti sulla stessa base geometrica;
- **7 mappe** `STATO_BADGE`/`STATO_CLASS` che duplicavano lo stesso vocabolario di colore con **rese
  divergenti** — lo stesso verde in dark a due opacità diverse, lo stato `annullato` una volta su un
  grigio letterale e una volta sul token neutro, pur essendo lo stesso enum di dominio;
- una taglia fuori scala (il KDS, che si legge da lontano) trattata come eccezione locale.

Finché il vocabolario vive nei call-site, "cambiare il verde di stato" è un rename su 7 file con 3
rese diverse — e la legge #1 resta una dichiarazione d'intenti.

## Decisioni

### D1 — La terna `warn` / `success` / `info`: una forma sola

Il token nudo è il colore **forte** (testo/bordo), il `-soft` è la **tinta di fondo**. La coppia
d'uso è sempre `text-<stato>` su `bg-<stato>-soft`.

| token                                                | light                 | dark                  |
| ---------------------------------------------------- | --------------------- | --------------------- |
| `--warn` / `--warn-soft` _(già in main da ADR-0083)_ | amber-600 / amber-100 | amber-400 / amber-950 |
| `--success` / `--success-soft`                       | green-600 / green-100 | green-400 / green-950 |
| `--info` / `--info-soft`                             | blue-600 / blue-100   | blue-400 / blue-950   |

La coppia regge in entrambi i temi perché **si ribaltano entrambi i token** (forte 600→400, soft
100→950): non è una scelta estetica, è ciò che tiene il contrasto quando il fondo si inverte.
Valori presi dalla scala Tailwind, stessa forma già scelta per `--warn`.

> ⚠️ **Valori superati** — il gradino chiaro è **700**, non 600, dall'[emendamento
> 2026-08-26](#emendamento-2026-08-26--la-misura-ha-guardato-un-tema-solo): in chiaro il 600 stava
> sotto AA. La **forma** descritta qui resta valida; i valori della tabella no.

### D2 — `destructive` è l'eccezione, e il conteggio viene dalla misura

Lo scope iniziale elencava **5 variabili nuove**, con `--destructive-soft` da solo. **Da solo non
funziona**, e non è emerso da una revisione a vista: è emerso **misurando**.

`--destructive` è nato come colore di **sfondo** — `Button`/`Alert` ci mettono sopra
`--destructive-foreground` — e in `.dark` va più **scuro** (L 60.2% → 30.6%), non più chiaro come i
tre stati sopra. Usarlo come **testo** su un fondo soffuso dà:

```
text-destructive su bg-destructive-soft, dark  →  1.61  ✗
```

Illeggibile. Formalmente ci sarebbero "due temi" (legge #4), ma la legge #3 — che è una legge sulla
**leggibilità**, non sulla presenza di un valore — sarebbe violata nella sostanza. Serve quindi un
foreground proprio, che si ribalta come gli altri stati:

| token                                                  | light             | dark              |
| ------------------------------------------------------ | ----------------- | ----------------- |
| `--destructive-soft` / `--destructive-soft-foreground` | red-100 / red-600 | red-950 / red-400 |

```
text-destructive-soft-foreground su bg-destructive-soft  →  3.95 light · 5.84 dark  ✓
```

Naming allineato alla coppia `--accent-soft` / `--accent-soft-foreground` già nel seam. L'entry
`destructive-soft` nel preset è **separata** da `destructive`: toccare quella esistente cambierebbe
la resa attuale, e questa PR deve essere invariante.

> **Il conteggio finale — 6 variabili, 12 valori (6 × 2 temi) — non viene dalla lista di scope: viene
> dalla misura del contrasto.** La lista diceva 5. La misura ha detto 6. Ha vinto la misura. È lo
> stesso criterio con cui in ADR-0083 il seam è risultato 3 variabili × 2 temi dal diff del build e
> non dall'ispezione a vista: quando una legge è quantitativa, il numero lo decide lo strumento.

Contrasti dell'intera terna, per confronto con la baseline `--warn` già in produzione:

| coppia                          | light | dark |
| ------------------------------- | ----- | ---- |
| `warn` _(baseline già spedita)_ | 2.86  | 8.97 |
| `success`                       | 3.00  | 8.55 |
| `info`                          | 4.24  | 5.78 |
| `destructive-soft`              | 3.95  | 5.84 |

> ⚠️ **Nessuno di questi quattro numeri in colonna `light` raggiunge AA (4.5)**, e la tabella non lo
> dice perché confronta i quattro stati **fra loro**, non con una soglia. È il difetto corretto
> dall'[emendamento 2026-08-26](#emendamento-2026-08-26--la-misura-ha-guardato-un-tema-solo).

⚠️ **Non risolto qui**: `destructive` è mappato nel preset **senza** `<alpha-value>`, quindi
l'`bg-destructive/10` usato oggi nei call-site **non produce alcuna trasparenza**. Il token soft lo
rende superfluo, ma la discrepanza del preset resta nota e **rimandata a P4** — qui è aggirata, non
sanata.

### D3 — `Badge`: le variant vengono dai call-site, non dall'immaginazione

Clona il pattern di `button.tsx`: `cva` + `forwardRef` + `VariantProps`, export
`{ Badge, badgeVariants }`, barrel in ordine alfabetico.

- `variant`: `default` · `secondary` · `destructive` · `info` · `success` · `warn`. I primi tre erano
  già su token; gli altri tre erano letterali e ora passano dai token di D1/D2.
- `size`: `default` e `lg`. `lg` è la taglia del KDS, l'unica che divergeva dalla base — la board di
  cucina si legge da lontano, non è un vezzo.
- Nessun bisogno di icona, dot o `onRemove`: **nessun call-site reale li usa**.

**Server-safe di proposito** (nessun `'use client'`): è uno `<span>` senza stato né handler, e
nessun altro file del barrel porta la direttiva.

### D4 — Additivo puro, e la prova è il build

Nessun call-site è adottato in questa PR: l'adozione è di PR3 in avanti. La proprietà da dimostrare
non è "non credo di aver rotto nulla", è **"il CSS generato non cambia"**.

`next build` isolato (dev server spenti, `.next` rimossi da entrambi i lati), su **entrambe** le app,
diff `main` vs branch sulle dichiarazioni dei blocchi `:root` / `.dark`:

|                        | `:root` | `.dark` |
| ---------------------- | ------- | ------- |
| **modificate/rimosse** | **0**   | **0**   |
| aggiunte               | 6       | 6       |

Identico su restaurant-web e accountant-web. Più 8 regole utility nuove (`bg-*-soft`, `text-*`),
tutte su token, **zero modificate**.

### D5 — Tailwind scansiona i commenti: niente nomi di utility in `packages/ui`

Trovato **dalla verifica di D4**, non a vista. Il primo build mostrava due utility letterali nel
bundle di **entrambe** le app, senza che alcun codice le usasse:

```
.bg-green-900\/30      ← citata in un commento di badge.tsx
.text-blue-800         ← idem
```

Le app hanno `packages/ui/src/**` nel `content` di Tailwind, che estrae i candidati dal **testo
grezzo** del file — **commenti inclusi**. Citare un letterale per scrivere _"questo era un
letterale"_ lo trasforma in una regola CSS vera; in restaurant-web era CSS morto, prodotto da un file
che predica la legge #1.

**Regola per il package**: nei commenti di `packages/ui` i colori si descrivono a parole
(blu/verde/ambra), mai col nome dell'utility. La nota vive in `badge.tsx` perché non venga
reintrodotta.

## Verifica

- **Unit** — `ui.smoke.test.tsx`, 18 test (9 nuovi). Un caso per variant che asserisce la **coppia di
  token esatta**: è il test che impedisce di reintrodurre un letterale al posto del token. Più le due
  size e il last-wins di `className` sul conflitto Tailwind.
- **Contrasti** — calcolati sui valori reali della palette letta da `node_modules`, non a memoria.
- **Invarianza** — vedi D4: `0` dichiarazioni modificate o rimosse, su entrambe le app.

## Impatto

- Diff confinato a `packages/ui/` — nessun file applicativo.
- **Altro verticale: verificato = INVARIATO** (stessa prova, stessi 12 valori aggiunti, su entrambe
  le app).
- `packages/db` / schema / permessi: non toccati → migration e propagazione **N.A.**
- Nessuna resa cambia in nessuna pagina: `Badge` non è consumato da alcun call-site.

## Roadmap

1. **PR3 (P2)** — dashboard FE restaurant: prima cliente di `Badge` e dei token di stato, sul
   contratto di ADR-0084.
2. **Adozione** — sostituzione dei 24+ `<span>` e delle 7 mappe `STATO_*`. È lì che i token
   ripagano: le rese divergenti collassano su una sola.
   ⚠️ **Promosso da lavoro parallelo a PREREQUISITO BLOCCANTE** (amendment ADR-0083 2026-08-24): sul
   lato accountant questa adozione è la fase **P3b-0**, e deve precedere P3b (il ritocco dei neutri
   condivisi). Un letterale è per definizione ciò che nessun cambio di token raggiunge: toccare i
   neutri con i 94 letterali accountant ancora in piedi lascerebbe 94 punti fermi mentre tutto il
   resto si muove — difetto garantito, non rischio.
3. **P4** — allineamento di `destructive` (e delle altre entry pre-esistenti) alla forma
   `<alpha-value>`, oggi rimandato.
4. `Table` / `Select` / `Toast` — fuori da P2 per scelta, deferiti alla fase di adozione dove hanno
   consumer reali.

---

## Emendamento 2026-08-26 — la misura ha guardato un tema solo

- **Stato**: Accettato
- **Contesto PR**: **P3b-α**, precede P3b-0 (adozione dei letterali accountant). Nasce da lì: la fase di
  adozione ha misurato anche la **baseline**, e la baseline ha smentito il target.
- **Slice**: `packages/ui` — 4 valori in `tokens.css` + il gate di contrasto. Nessun call-site adottato.

### Cosa era sbagliato

Questo ADR ha misurato le coppie di stato **a mano, una volta**, e — si scopre ora — **di fatto in un
tema solo**.

Per `destructive` §D2 fece il ragionamento giusto: il gradino forte è nato per fare da **sfondo**, non
regge come **testo**, quindi serve un foreground proprio. Quel ragionamento **non è stato
generalizzato** a `warn` / `success` / `info`, perché per quei tre la misura si era fermata dove il
problema non c'era. La legge #4 dice «due temi sempre», e lo strumento che doveva farla rispettare
ne ha guardato uno.

Conseguenza: i foreground **chiari** sono rimasti sotto AA per due sessioni, in produzione.

| coppia, tema chiaro  | riportato in §D1/§D2 | soglia AA | esito reale |
| -------------------- | -------------------- | --------- | ----------- |
| `warn` su soffuso    | 2.86                 | 4.5       | ✗           |
| `success` su soffuso | 3.00                 | 4.5       | ✗           |
| `info` su soffuso    | 4.24                 | 4.5       | ✗           |
| `destructive-soft`   | 3.95                 | 4.5       | ✗           |

I numeri **erano scritti nell'ADR**. Nessuno li ha confrontati con una soglia: la tabella serviva a
confrontare i quattro stati **fra loro**, non con un criterio esterno. Una misura senza soglia non è
un criterio, è un'osservazione.

### Perché è emerso solo adesso

Perché P3b-0 ha misurato la **baseline** oltre al target. I letterali che i token dovevano sostituire
(il gradino 800/900, scelto a occhio) stavano in chiaro a **6.4–8.5**; i token a **2.87–4.23**. La
sostituzione, così com'era, avrebbe **dimezzato la leggibilità** di ogni pastiglia di stato
dell'accountant — 32 pagine — presentandola come applicazione della legge #1.

> Il target da solo non dice mai se stai migliorando. Se la sostituzione ha un "prima", il prima si
> misura.

### Dove sta questa rettifica

Accanto alle **rettifiche di metodo S21–S22** (`docs/handoff/HANDOFF.md`), stessa famiglia: **verifica
parziale presentata come completa**, come il `head -60` sul Caddyfile. Con un aggravante e
un'attenuante.

- **Aggravante**: lì il difetto stava in una conclusione riportata; qui è entrato **nei token**, cioè
  nel file che tutto il resto consuma, ed è sopravvissuto a due ADR e a un deploy.
- **Attenuante**: è stato trovato dal metodo giusto — misurare invece di guardare — applicato una
  volta di più.

Ed è anche un caso della **asimmetria** già registrata in HANDOFF: era un **verde falso**. Il rosso
obbliga a guardare, il verde autorizza a smettere.

### D5 — La correzione: gradino 700 in chiaro, scuro invariato

| token                           | chiaro prima | chiaro ora    | scuro     |
| ------------------------------- | ------------ | ------------- | --------- |
| `--warn`                        | amber-600    | **amber-700** | amber-400 |
| `--success`                     | green-600    | **green-700** | green-400 |
| `--info`                        | blue-600     | **blue-700**  | blue-400  |
| `--destructive-soft-foreground` | red-600      | **red-700**   | red-400   |

Lo **scuro non si tocca**: lì il 400 regge (8.5–12.0) e ha sempre retto. I `-soft` non si toccano.

Contrasti misurati, **prima → dopo** (chiaro / scuro):

| coppia                      | prima        | dopo             |
| --------------------------- | ------------ | ---------------- |
| attenzione su soffuso       | 2.87 / 8.99  | **4.50** / 8.99  |
| attenzione su fondo pagina  | 3.19 / 11.99 | **5.01** / 11.99 |
| attenzione su card          | 3.19 / 11.99 | **5.01** / 11.99 |
| positivo su soffuso         | 3.00 / 8.55  | **4.57** / 8.55  |
| positivo su fondo pagina    | 3.29 / 11.47 | **5.02** / 11.47 |
| positivo su card            | 3.29 / 11.47 | **5.02** / 11.47 |
| informativo su soffuso      | 4.23 / 5.77  | **5.50** / 5.77  |
| informativo su fondo pagina | 5.17 / 7.85  | **6.71** / 7.85  |
| informativo su card         | 5.17 / 7.85  | **6.71** / 7.85  |
| distruttivo su soffuso      | 3.95 / 5.84  | **5.29** / 5.84  |
| distruttivo su fondo pagina | 4.83 / 7.23  | **6.46** / 7.23  |
| distruttivo su card         | 4.83 / 7.23  | **6.46** / 7.23  |

Tutte e 12 le coppie di stato sono AA in entrambi i temi. **Le tre superfici non sono un elenco a
piacere**: `-soft` è la pastiglia (l'unica forma che §D1 avesse misurato), `--background` e `--card`
sono le superfici che l'adozione nei call-site introduce — e che nessuno aveva mai misurato.

### D6 — Il gate: la misura non è più un atto, è una proprietà

`packages/ui/src/contrast.ts` (motore) + `contrast.test.ts` (il gate), dentro `pnpm test`.

Estende la misura di §D1/§D2 in tre direzioni:

1. **dalle coppie in isolamento alle coppie come si presentano nei call-site reali** — forte su
   soffuso, ma anche su `--background` e su `--card`;
2. **al seam per-verticale** — la coppia soffusa dell'accento non vive in `tokens.css`, e misurarla
   sul solo file condiviso vorrebbe dire non misurarla. Il gate legge i `globals.css` per-app e li
   sovrappone alla base, nell'ordine della cascata reale. Il fondo scuro è composto a opacità ridotta
   **come lo scrive il call-site**: la coppia non è la stessa nei due temi, e trattarla come se lo
   fosse la falserebbe;
3. **a entrambi i temi, sempre**, che è il difetto originario reso impossibile.

Quattro proprietà, ognuna contro un modo diverso di produrre un verde falso:

- **rapporti pinnati** — una deriva dei valori diventa rossa, non passa;
- **nessun silenzio sotto soglia** — una coppia sotto AA senza nota scritta è rossa; e una nota
  rimasta su una coppia **rientrata** pure. È per questo che la correzione qui sopra è dimostrata dal
  **diff del gate**, non argomentata: le note cadono da sole;
- **censimento degli usi** — ogni token di stato trovato nei sorgenti (`apps/*/src` e
  `packages/*/src`, derivati dal filesystem: un verticale nuovo entra da solo) deve appartenere a una
  coppia dichiarata. Senza, il gate verificherebbe solo ciò che gli abbiamo detto di verificare —
  falso verde **per costruzione**;
- **inventario vuoto = rosso** — zero coppie o zero verticali trovati non è mai verde (stessa regola
  del gate permessi).

**Prova di efficacia** — un gate che non può diventare rosso non è un gate (S22, rettifica 3).
Verificato rosso su tre vie, e verde di nuovo dopo ognuna:

| via                                                    | esito                                   |
| ------------------------------------------------------ | --------------------------------------- |
| valori **pre-correzione** (2.87 / 3.00, non inventati) | rosso, con i due casi peggiori nominati |
| deriva di un valore in `tokens.css`                    | rosso su pin **e** su nota stantia      |
| token di stato usato in un file non dichiarato         | rosso, col punto esatto                 |

La prima resta committata come test permanente: dimostra che il gate **avrebbe intercettato** il
difetto che questa PR corregge.

### D7 — `console.table`: §D5 non parlava solo di colori

Il primo giro del diff del CSS **non** era invariante. La chiamata che formatta una griglia sulla
console porta, nel proprio nome, il nome di un'utility di layout: Tailwind l'ha estratta dal testo
grezzo del file di test e ha emesso una regola vera nel bundle di **entrambe** le app.

§D5 diceva «nei commenti di `packages/ui` i colori si descrivono a parole». La regola è più larga di
com'era scritta: **nessun identificatore, nome di API o testo di questo package può coincidere con un
nome di utility Tailwind** — colore o no, commento o codice. Trovato dal diff, non a vista, per la
seconda volta.

### Verifica

- **Gate** — 64 test verdi, valori riportati per ogni coppia e tema.
- **CSS emesso, entrambe le app** — **4** dichiarazioni cambiate in `:root`, **0** in `.dark` (blocco
  identico all'hash), **0** regole aggiunte o rimosse (493 accountant, 399 restaurant: invariati).
  Nessuna regola spuria.
- **Resa restaurant, misurata** — vedi §Impatto.

### Impatto

**Altro verticale: verificato — sì, si muove, ed è voluto.** È la differenza con PR0, dove
l'invarianza era l'obiettivo: qui il cambiamento è desiderato anche di là, quindi va **misurato**, non
assunto benigno.

La dashboard restaurant mappa `aperto` → informativo e `chiuso` → positivo (`STATO_VARIANT`), quindi
**due pastiglie su tre** cambiano il colore del testo in tema chiaro. Misurato in Chromium sul CSS
**realmente emesso** dall'app e sulle classi lette da `badge.tsx`, con il tema impostato **nel
sorgente della pagina e mai mutato a runtime** (S21, rettifica 1 — senza quella condizione al
contorno la tecnica produce guasti immaginari):

| variant     | tema    | prima            | dopo             | contrasto       |
| ----------- | ------- | ---------------- | ---------------- | --------------- |
| informativo | chiaro  | `rgb(37,99,235)` | `rgb(29,78,216)` | 4.24 → **5.49** |
| positivo    | chiaro  | `rgb(22,163,74)` | `rgb(21,128,61)` | 3.00 → **4.57** |
| informativo | scuro   | invariato        | invariato        | 5.78            |
| positivo    | scuro   | invariato        | invariato        | 8.55            |
| secondary   | ambedue | invariato        | invariato        | 16.30 / 13.98   |

I valori del browser coincidono con quelli calcolati dal gate a meno della quantizzazione a 8 bit
(5.49 vs 5.50, 13.98 vs 13.95): le due misure sono indipendenti e si confermano a vicenda.

⚠️ **Limite dichiarato**: la misura è stata fatta sul CSS emesso e sulle classi reali, **non sulla
pagina servita** (`[data-testid="dashboard-conti"]` esiste, ma serve uno stack dev montato dal
branch). È lo stesso limite di `TD-smoke-punta-solo-a-prod` (ADR-0083): non esiste oggi un'istanza
effimera costruita dal branch su cui puntare. Il colore di una pastiglia non dipende dal contesto di
pagina — nessun antenato applica opacità o filtri — ma la lacuna è questa, non un'altra.

- `packages/db` / schema / permessi: non toccati → migration e propagazione **N.A.**
- Nessun call-site adottato: le 34 righe di letterali accountant restano a **P3b-0**.

### Debiti registrati (preesistenti, non introdotti qui)

- 🆕 **`TD-bordo-circolari-sotto-soglia`** — `apps/accountant-web/src/app/t/[slug]/portale/circolari/[id]/page.tsx:129`:
  il bordo del box "conferma richiesta" sta a **1.43** in chiaro e **2.65** in scuro, contro la soglia
  non-testo di 3 — **già oggi**, coi letterali. Va corretto dove il bordo avrà un token, non sanato di
  soppiatto insieme ad altro. **Trigger**: P3b-0, quando quella riga passa ai token.
- 🆕 **`TD-accountant-zero-copertura-e2e`** — l'accountant ha **zero e2e pre-merge**: `page-tour` punta
  a produzione anche in locale (`PLAYWRIGHT_BASE_URL` in `.env.e2e`), non c'è un `data-testid` su
  alcun elemento di stato, e il seed non crea mandati/circolari/note spese/comunicazioni. È il debito
  che rende costoso verificare qualunque cambio di resa su quell'app — ed è più grande di P3b-0.
  Parente di `TD-smoke-punta-solo-a-prod`, che è il lato infrastrutturale dello stesso problema.

### Rettifiche ai paragrafi precedenti di questo ADR

- **§D1** — la tabella dei valori è **superata**: il gradino chiaro è 700, non 600. La forma (nudo =
  forte, `-soft` = fondo; entrambi si ribaltano in `.dark`) resta valida.
- **§D2** — la conclusione resta corretta e la sua **portata era più larga di come fu scritta**: il
  gradino forte non fa da testo, e questo vale per tutti e quattro gli stati, non solo per
  `destructive`.
- **§D5** — vedi §D7: la regola non riguarda solo i colori e non solo i commenti.
- **§Verifica** — «contrasti calcolati sui valori reali della palette» era vero e **insufficiente**:
  i valori erano reali, i temi verificati no. Da qui in avanti lo fa il gate.

---

## Emendamento 2026-08-26 (2) — P3b-0: adozione nei call-site accountant

- **Stato**: Accettato
- **Contesto PR**: **P3b-0**, prerequisito bloccante di P3b (amendment ADR-0083 2026-08-24). Segue P3b-α,
  che ha corretto i foreground e posato il gate — l'adozione arriva **sopra token gia' corretti**, non prima.
- **Slice**: `apps/accountant-web` (16 file) + le dichiarazioni nel gate. Nessun valore di token toccato.

### Cosa e' stato fatto

**94 occorrenze su 34 righe** di letterali colore Tailwind sostituite dai token di stato. Restano **3
occorrenze**, dichiarate qui sotto. L'unita' di intervento e' la **riga**, non l'occorrenza: sulle mappe
nessuna riga era interamente invariante, e spezzarla avrebbe prodotto righe mezze tokenizzate.

Le **rese divergenti collassano su una sola**. Prima lo stesso stato aveva scritture diverse a seconda
del file: il verde in scuro a due opacita' (30% e 40%), `annullato` una volta su `gray` letterale e una
volta sul token neutro, il gradino del testo 800 o 900 senza criterio.

### D8 — Il gate ha smesso di essere teorico

L'emendamento precedente (§D6) aveva costruito il censimento degli usi ma **non aveva ancora nulla da
censire** nei call-site: `apps/accountant-web` non usava un solo token di stato. Con questa PR ha smesso
di essere una precauzione:

- alla prima esecuzione dopo le sostituzioni il gate e' diventato **rosso su 52 usi non coperti**,
  col punto esatto (file, riga, utility). Non e' un aneddoto: e' la dimostrazione che il ramo
  "coppia usata nel codice ma assente dall'inventario" funziona su codice vero, e non solo sul caso
  di prova iniettato;
- otto coppie che erano dichiarate **a vuoto** (`usi: []`) hanno ora i file che le consumano;
- una coppia **nuova**: `--foreground` su `--background` (19.99 / 19.09), che serve al giorno corrente
  del calendario.

⚠️ **Limite dichiarato**: il censimento copre solo il vocabolario di STATO. I **neutri**
(`--foreground`, `--muted`, `--muted-foreground`, `--background`) non sono censiti: le tre righe che
finiscono sui neutri sono **misurate ma non gatate**. Chiuderlo significa allargare il vocabolario, e
allargarlo oggi produrrebbe centinaia di usi preesistenti da dichiarare in blocco — che e' lavoro di
P3b, dove i neutri si toccano davvero.

### D9 — Le 3 eccezioni decorative

Restano letterali le **3 occorrenze di `CalendarioMese.tsx:107`** — la cella selezionata del
calendario delle note spese:

| occorrenza               | ruolo                            |
| ------------------------ | -------------------------------- |
| bordo blu 500            | contorno della cella selezionata |
| fondo blu 50 (chiaro)    | tinta della cella selezionata    |
| fondo blu 900/30 (scuro) | la stessa, in tema scuro         |

**Perche' nessun token va bene**, e non e' pigrizia:

- **l'accento e' escluso dalla legge #2** — `--primary` / `--accent-soft` sono riservati al
  significato (denaro, azioni terminali, stato attivo della navigazione). "Questo giorno e'
  selezionato in un calendario" non e' quello;
- **uno stato semantico sarebbe una bugia** — `info` significa "informativo" nel vocabolario di
  dominio. Usarlo per una selezione lo svuota: il giorno dopo `text-info` non vuol dire piu' niente,
  ed e' esattamente il modo in cui un design system muore;
- **inventare un token decorativo violerebbe la legge #1 al contrario** — un token nato per un solo
  call-site non e' un token, e' un letterale con un nome.

La risposta naturale arriva quando il sistema di base prende forma e i neutri hanno una scala:
una selezione si dice con una **superficie**, non con un colore. **Trigger: P3b.**

`CalendarioMese:116` ("oggi") **non** e' in questa lista: e' andato su `--foreground`, enfasi neutra.
Il giorno corrente si distingue per peso, non per tinta — col grassetto gia' presente il segnale
resta, e il contrasto sale da 6.70/11.08 a 19.99/19.09.

### D10 — I 4 hex colori-dato sono fuori dalla legge #1, per costruzione

| file                    | valore                                     |
| ----------------------- | ------------------------------------------ |
| `CategoriaForm.tsx:34`  | default del selettore di colore categoria  |
| `catalogo/page.tsx:93`  | default del colore categoria (stato React) |
| `catalogo/page.tsx:186` | lo stesso, al reset del form               |
| `scadenze/page.tsx:347` | fallback quando la categoria non ha colore |

Sono **default e fallback di un colore scelto dall'utente e persistito in DB**, resi via `style={{}}`.
Nessun token li raggiunge **per definizione**: il valore vero arriva dal database a runtime, e il
letterale e' solo cio' che si mostra quando quel valore manca.

**Non sono una violazione della legge #1.** La legge #1 dice che il _design_ passa dai token; questi
non sono design, sono **dati**. Confonderli produrrebbe la conclusione sbagliata — "tokenizzali" —
che significherebbe togliere all'utente la scelta del colore. Vanno **detti**, non sanati.

### D11 — Il collasso in `Badge` resta aperto

Le 8 mappe restano `Record<Enum, string>` di classi, non `Record<Enum, BadgeProps['variant']>`.
Adottare la primitiva ora porterebbe **geometria**, non solo colore: `inline`/`inline-block` →
`inline-flex` su 6 call-site, `font-medium` imposto su 2, e toccherebbe 2 voci `respinta` che sono
gia' su token e quindi non hanno niente da guadagnare.

E' **cambio di layout su pagine con zero copertura e2e e zero dati di seed** — cioe' proprio le
condizioni in cui non si vede quello che si rompe. E non blocca P3b: un token adottato e' raggiunto
dal cambio dei neutri, che la pastiglia sia un `<span>` o un `Badge`.

Costo accettato: le 8 mappe verranno riscritte due volte. Sono 8 punti, e la seconda riscrittura
avvera' con la primitiva gia' provata da altri call-site. Resta §Roadmap punto 2.

### Verifica

**Classificazione ricalcolata** contro i token post-P3b-α (le classi di ieri erano calcolate sul
gradino 600 e non valevano piu'): su 32 righe classificate — **17 peggiorano** in entrambi i temi,
**8 miste**, **4 invarianti**, **3 migliorano**.

Il calo e' strutturale e voluto: i letterali `-800`/`-900` su `-100` erano coppie sovra-contrastate
scelte una per una, il token e' una scelta sola e misurata. **Tutte le righe che calano restano sopra
AA tranne una**, ed e' dichiarata:

| riga                    | prima                              | dopo                  | nota                                         |
| ----------------------- | ---------------------------------- | --------------------- | -------------------------------------------- |
| pastiglie di stato (14) | 6.37–8.49 chiaro · 11.6–15.7 scuro | 4.50–5.50 · 5.77–8.99 | sopra AA in entrambi                         |
| `mandati:32 annullato`  | 8.33 / 8.33                        | **4.34** / 5.70       | **sotto AA in chiaro** — vedi sotto          |
| 4 voci senza `dark:`    | 6.37–7.15 in un tema solo          | 8.55–8.99 in scuro    | il token **corregge un difetto**             |
| `comunicazioni/[id]:37` | 19.27 / **1.01**                   | 18.25 / 13.95         | il difetto piu' grosso trovato dall'adozione |

**`mandati:32 annullato`** e' il caso peggiore: `bg-gray-200 text-gray-700` (letterale `gray`, mentre
i neutri del sistema sono `slate`) → `--muted` / `--muted-foreground`, che sta a **4.34** in chiaro.
La coppia era gia' nel gate con nota e trigger P3b — e' il neutro ereditato da shadcn, non introdotto
dal design system — ma **da qui non e' piu' teorica**: ha un consumer su una pagina reale. La nota nel
gate e' aggiornata di conseguenza. Alzarla qui significherebbe cambiare i neutri di entrambi i
verticali fuori dalla fase che li possiede.

**CSS emesso** — `restaurant-web` **byte-identico** (`cmp` a zero): e' l'app che non deve muoversi, ed
e' quella che rivela le regole spurie. Su `accountant-web`:

|                                |                       |
| ------------------------------ | --------------------- |
| selettori rimossi              | **39**                |
| di cui NON letterali di colore | **0**                 |
| selettori aggiunti             | **1** (`border-warn`) |
| regole comuni **modificate**   | **0**                 |

Le utility su token erano gia' nel bundle (`badge.tsx` e' nel `content` di Tailwind): l'adozione ne
aggiunge una sola. Le 3 regole delle decorative sono ancora emesse, come dev'essere.

**Totalita' delle mappe** — provata togliendo una voce: `error TS2741: Property 'annullato' is missing
in type ... but required in type 'Record<StatoMandato, string>'`. Un enum non coperto e' un errore di
compilazione, non un `undefined` a runtime.

**Censimento residuo** — 3 occorrenze, tutte su `CalendarioMese:107`, piu' i 4 hex colori-dato. Zero
altro. E' il gate che dimostra che **P3b puo' procedere**.

### `TD-accountant-zero-copertura-e2e` — dettaglio verificato

Registrato nell'emendamento precedente. Verificato a `7f011b5`, con i dettagli che ne fissano la
portata: `apps/accountant-web/.env.e2e` contiene `PLAYWRIGHT_BASE_URL=https://studiodesk.cloud`, e
`playwright.smoke.config.ts` ha lo **stesso default in codice** — quindi anche in locale, anche senza
`.env.e2e`, lo smoke misura **la produzione**, mai il branch. Non c'e' un `data-testid` su alcun
elemento di stato, e il seed non crea mandati, circolari, note spese o comunicazioni: le pagine
ridipinte da questa PR sono, in sviluppo, **vuote**.

E' il debito che rende costoso verificare qualunque cambio di resa su quest'app, ed e' piu' grande di
P3b-0. Parente di `TD-smoke-punta-solo-a-prod` (ADR-0083), che e' il lato infrastrutturale.

⚠️ Conseguenza diretta su questa PR: **nessuna verifica runtime**. La resa e' provata dalla misura
(gate) e dal diff del CSS, non dagli occhi su una pagina con dati.

### Impatto

- **Altro verticale: verificato — INVARIATO.** CSS di `restaurant-web` byte-identico. E' il verso
  opposto di P3b-α, dove il movimento era voluto: qui l'accountant si muove e il restaurant no.
- `packages/db` / schema / permessi: non toccati → migration e propagazione **N.A.**
- `packages/ui`: toccato solo l'inventario del gate. Nessun valore di token, nessun componente.
