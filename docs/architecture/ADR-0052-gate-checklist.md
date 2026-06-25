# ADR-0052 — GATE Checklist obbligatoria (FE + BE + DB)

**Data:** 2026-06-26  
**Stato:** Accettato  
**Provenienza:** Decisione Nicolò — verifica dark mode mancante rilevata in produzione (post PR #120/#121); analisi gap processo sessione Onda 3 Task 2.

---

## Contesto

Il GATE esistente (ADR-0027) copre typecheck / lint / format / e2e. Non copre:

- Correttezza visiva in dark mode
- Parità chiavi i18n IT↔EN
- Build produzione Next.js
- Copertura RBAC minima per modulo
- Soft-delete invisibility per modulo
- Migration deploy su DB pulito
- Responsive/mobile
- Accessibilità base

Questi gap hanno prodotto regressioni visibili all'utente finale non intercettate dal CI. L'obiettivo di questo ADR è rendere i check **obbligatori, sistematici e non delegabili alla review manuale**.

---

## Decisione

Ogni PR che tocca le aree indicate deve superare **tutti i check applicabili** prima di aprire la PR. Il self-check report di Code deve riportare esito esplicito per ciascuno. Un check non eseguito = PR non pronta.

---

## Checklist per area

### FE (qualsiasi PR che tocca `apps/accountant-web/src/`)

**CHECK-FE-1 — Dark mode**

```bash
grep -rn "bg-white\|bg-gray-\|bg-slate-\|text-gray-\|text-slate-\|border-gray-" \
  apps/accountant-web/src --include="*.tsx" | grep -v "dark:" | grep -v "\.test\."
```

Risultato atteso: zero righe. Ogni elemento visibile deve avere variante `dark:` o usare CSS variables del design system. Nessun colore hardcoded senza controparte dark.

> **Nota:** alcuni componenti shell (es. Sidebar) usano `bg-white`/`border-gray-200` intenzionalmente — valutare output caso per caso, non trattare come fail automatico.

**CHECK-FE-2 — i18n parity IT↔EN**

```bash
node -e "
const it = require('./apps/accountant-web/src/i18n/messages/it.json');
const en = require('./apps/accountant-web/src/i18n/messages/en.json');
const flat = (obj, p='') => Object.entries(obj).flatMap(([k,v]) =>
  typeof v === 'object' ? flat(v, p+k+'.') : [p+k]);
const missing = flat(it).filter(k => !flat(en).includes(k));
if (missing.length) { console.error('FAIL — chiavi mancanti in EN:', missing); process.exit(1); }
else console.log('OK — parità IT/EN');
"
```

Risultato atteso: `OK — parità IT/EN`. Zero chiavi in IT senza corrispondente EN.

**CHECK-FE-3 — Stringhe hardcoded IT nei componenti**

```bash
grep -rn '"[A-ZÀÈÉÌÒÙ][a-zàèéìòù ]' \
  apps/accountant-web/src/components \
  apps/accountant-web/src/app \
  --include="*.tsx" | \
  grep -v "//\|className\|href\|key=\|type=\|value=\|aria-\|data-\|name=\|\.test\."
```

Risultato atteso: zero righe con label visibili hardcoded in italiano. Tutte le stringhe UI passano per `t('chiave')`.

> **TD-i18n-zod (noto, escluso dal check):** i messaggi di validazione nei DTO/schema **zod** dei form (es. `ScadenzaForm`, `PreventivoForm`) sono in italiano hardcoded — sono definiti a livello di modulo, fuori dal contesto React, quindi non passano per `t()`. È un debito trasversale a tutti i form: NON va corretto caso per caso (incoerente), ma in una slice dedicata che affronta tutti i form insieme. Fino ad allora questo check ignora i messaggi `message:` negli schema zod.

```bash
pnpm --filter accountant-web build
```

Risultato atteso: build completata senza errori. Warning accettabili, errori no.

**CHECK-FE-5 — Responsive/mobile**
Verifica manuale obbligatoria (non automatizzabile a costo zero). Code apre le pagine modificate in Chromium a viewport 390×844 (iPhone 14) e riporta:

- Nessun overflow orizzontale
- Sidebar collassabile o nascosta su mobile
- Form e tabelle leggibili senza scroll orizzontale

Riportare: "Verificato mobile 390px: [lista pagine] — OK" oppure lista problemi trovati.

**CHECK-FE-6 — Accessibilità base**

```bash
# Verifica attributi aria e alt mancanti nei componenti modificati
grep -rn "<img\|<button\|<input\|<select\|<textarea" \
  apps/accountant-web/src --include="*.tsx" | \
  grep -v "alt=\|aria-\|aria-label\|htmlFor\|\.test\." | head -20
```

Risultato atteso: zero elementi interattivi senza label accessibile. Immagini con `alt`. Input con `htmlFor` o `aria-label`.

---

### BE (qualsiasi PR che tocca `apps/accountant-api/src/`)

**CHECK-BE-1 — RBAC minimo per ogni nuovo modulo**
Ogni nuovo modulo e2e deve contenere almeno questi tre scenari:

1. Utente con permesso `*.visualizza` tenta `POST /risorsa` → 403
2. Utente con permesso `*.gestisci` esegue `POST /risorsa` → 201
3. Utente tenant B tenta `GET /risorsa/:id` di tenant A → 404 (non 403)

Riportare: "RBAC scenari presenti in [nome spec]: viewer→403, gestore→201, cross-tenant→404 ✅"

**CHECK-BE-2 — Soft-delete invisibility per ogni nuovo modulo**
Ogni nuovo modulo e2e deve contenere almeno:

1. Dopo `DELETE /risorsa/:id`: `GET /risorsa` lista → record non presente
2. Dopo `DELETE /risorsa/:id`: `GET /risorsa/:id` → 404

Riportare: "Soft-delete invisibility verificata in [nome spec] ✅"

---

### DB (qualsiasi PR che tocca `packages/db/prisma/migrations/`)

**CHECK-DB-1 — Migration deploy su DB pulito**

**Già coperto dal CI e2e (primario).** La suite e2e (`pnpm --filter @gestionale/accountant-api test:e2e`) avvia a ogni run un Postgres **pulito** via Testcontainers e applica **tutte** le migration dall'inizio prima dei test. Un fallimento di `migrate deploy` (es. `ALTER TYPE ADD VALUE` in tx, enum duplicati, indici unici in conflitto) fa fallire l'intera suite → il check è di fatto sempre eseguito quando girano gli e2e.

**Verifica manuale esplicita (da eseguire localmente)** quando una PR tocca solo le migration senza toccare il BE (gli e2e potrebbero non girare): spin-up di un DB pulito e `migrate deploy` diretto. NB: gli script `prisma:migrate:*` del package usano il wrapper `dotenv -e ../../.env` → caricano il `DATABASE_URL` di `.env`; per puntare a un DB pulito si invoca `prisma` direttamente passando `DATABASE_URL` **e** `DIRECT_URL` (lo schema li usa entrambi), bypassando il wrapper.

```bash
# Da eseguire localmente (Docker richiesto)
cd /home/deploy/projects/gestionale
docker run --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gestionale_test \
  -p 5433:5432 -d --name pg_migrate_test postgres:16-alpine
sleep 3
DATABASE_URL="postgresql://postgres:test@localhost:5433/gestionale_test" \
DIRECT_URL="postgresql://postgres:test@localhost:5433/gestionale_test" \
  pnpm --filter @gestionale/db exec prisma migrate deploy
docker stop pg_migrate_test
```

Risultato atteso: tutte le migration applicate senza errori. In particolare: `ALTER TYPE ADD VALUE` non fallisce, enum già esistenti non duplicati, indici unici non in conflitto.

---

## Applicazione

| Check                         | Quando si applica                            |
| ----------------------------- | -------------------------------------------- |
| CHECK-FE-1 dark mode          | Ogni PR con modifiche `.tsx`                 |
| CHECK-FE-2 i18n parity        | Ogni PR con modifiche `.tsx` o `.json` i18n  |
| CHECK-FE-3 stringhe hardcoded | Ogni PR con nuovi componenti o pagine        |
| CHECK-FE-4 build produzione   | Ogni PR FE                                   |
| CHECK-FE-5 responsive         | Ogni PR con nuove pagine o layout modificati |
| CHECK-FE-6 accessibilità      | Ogni PR con nuovi form, button, input, img   |
| CHECK-BE-1 RBAC               | Ogni PR con nuovo modulo BE                  |
| CHECK-BE-2 soft-delete        | Ogni PR con nuovo modulo BE con soft-delete  |
| CHECK-DB-1 migration deploy   | Ogni PR con nuove migration                  |

---

## Conseguenze

- Il self-check report di Code deve riportare esito esplicito per ogni check applicabile.
- Un check non eseguito o fallito = PR non pronta. Nessuna eccezione.
- La review di Claude strategico verifica che il self-check report copra tutti i check applicabili prima di autorizzare il merge.
- I check entrano nei prompt STOP 1 di ogni feature da questa ADR in avanti.
- Le PR già mergiate (pre-ADR-0052) non vengono retroattivamente bloccate, ma i gap vengono chiusi dalla PR `fix/fe-darkmode-i18n` (in corso).

---

## Alternative considerate

- **Checklist separata `docs/process/GATE-checklist.md`**: scartata — frammentazione documentazione, stesso contenuto in due posti.
- **CI automatizzato per dark mode e responsive**: desiderabile a lungo termine, non implementato ora (costo alto, Playwright visual regression richiede setup dedicato).
- **Solo ADR-0027 aggiornato**: scartato — ADR-0027 è il gate tecnico (typecheck/lint/test), questo ADR aggiunge la dimensione qualitativa/UX. Separazione di concerns.
