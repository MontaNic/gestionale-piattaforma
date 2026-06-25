# ADR-0054 — Report margine

**Data:** 2026-06-26
**Stato:** Accettato
**Provenienza:** Decisione Nicolò — Onda 3 Task 4; scope locked in sessione prima di STOP 2.

---

## Contesto

Mandati (ADR-0051) e prestazioni (ADR-0053) producono i dati per una prima vista
analitica di **redditività**: quanto è stato concordato vs quanto sta costando
(in ore e importi registrati). Questo task aggiunge un report di **margine** per
mandato/azienda. È una vista **read-only** che aggrega dati già accessibili —
nessun nuovo modello, migration o permesso.

---

## Decisioni

### 1. Read-only puro

Nessuna modifica a schema/migration/seed. Un solo endpoint di aggregazione
`GET /report/margine`. Pattern `DashboardModule`.

### 2. Tre metriche per mandato

Per ogni mandato in-scope (`deletedAt: null`, **qualsiasi stato** — l'operatore
vede il quadro completo, non solo `in_corso`):

- **`oreTotali`** = Σ `prestazioni.ore` (tutte, indipendenti da `fatturabile`).
- **`importoPrestazioni`** = Σ `prestazioni.importo` delle sole righe con
  `importo` valorizzato; **`null`** se **nessuna** prestazione ha importo (costo
  stimato parziale, senza tariffario).
- **`margine`** = `importoConcordato − importoPrestazioni`; **`null`** se
  `importoPrestazioni` è `null`.

`importoPrestazioni = null` (non `0`) distingue **assenza di dato** da **costo
zero**: senza tariffario (Task 3b) gli importi sono parziali e il margine deve
poter dire "non calcolabile".

### 3. Lista flat, ordinata per margine ASC

Risposta = lista **flat** di righe (una per mandato, con `aziendaNome` come
colonna), ordinata per **`margine` ASC** (i peggiori/più negativi prima). Le
righe con `margine = null` (nessun dato costo) vanno **in coda**: ignoto ≠
peggiore. (Non un raggruppamento per azienda: l'ordinamento è globale.)

### 4. Permesso riusato

`report.operativo.visualizza` (esistente). Niente nuovo permesso per una vista
read-only che aggrega dati già accessibili al ruolo.

### 5. Decimal → number server-side

Le metriche sono **calcolate** nel service e ritornate come `number` (arrotondati
a 2 dp), non come Prisma Decimal-string: il FE le consuma direttamente.

### 6. Collocazione FE

**Pagina dedicata** `/t/<slug>/report/margine` (non una sezione della dashboard:
è una vista analitica, non un KPI operativo). Sidebar: nuovo **gruppo "Report"**
con voce "Margine" (icona `TrendingUp`). Margine colorato: verde > 0, rosso < 0,
grigio "—" se null.

### 7. Insight AI deferiti

Niente Groq/insight in questa slice: senza tariffario gli importi sono parziali →
un insight su dati incompleti è rumore. Rinviato a quando il tariffario (Task 3b)
è implementato.

---

## API

`GET /api/v1/report/margine` → `report.operativo.visualizza` → `{ data: MargineRow[] }`

```ts
interface MargineRow {
  mandatoId: string;
  codice: string;
  aziendaId: string;
  aziendaNome: string;
  stato: StatoMandato;
  importoConcordato: number;
  oreTotali: number;
  importoPrestazioni: number | null;
  margine: number | null;
}
```

---

## Conseguenze

- Prima vista di redditività disponibile; i margini negativi/parziali emergono
  in cima alla lista.
- Quando arriverà il tariffario (Task 3b), `importoPrestazioni` sarà completo e il
  margine pienamente significativo, senza modifiche all'endpoint.
- Il `ReportModule` ospiterà i futuri report analitici.

---

## Alternative considerate

- **Nuovo permesso `report.margine.visualizza`** → scartato: la vista aggrega dati
  già accessibili, `report.operativo.visualizza` è sufficiente.
- **Sezione nella dashboard esistente** → scartato: il margine è una vista
  analitica separata, non un KPI operativo della home.
- **`importoPrestazioni = 0` quando nessun importo** → scartato: nasconderebbe
  l'assenza di dato dietro un margine fittizio pari al concordato.
- **Margine sulle sole prestazioni `fatturabile`** → scartato per ora: si usa
  `importo` (il costo registrato), indipendente da `fatturabile`.
