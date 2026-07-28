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
2. **Adozione** (P3/P4) — sostituzione dei 24+ `<span>` e delle 7 mappe `STATO_*`. È lì che i token
   ripagano: le rese divergenti collassano su una sola.
3. **P4** — allineamento di `destructive` (e delle altre entry pre-esistenti) alla forma
   `<alpha-value>`, oggi rimandato.
4. `Table` / `Select` / `Toast` — fuori da P2 per scelta, deferiti alla fase di adozione dove hanno
   consumer reali.
