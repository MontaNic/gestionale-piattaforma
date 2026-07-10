# ADR-0070 — Semantica prezzi lordi (IVA inclusa) + snapshot aliquota su riga conto

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0067](./ADR-0067-modello-aggregato-conto.md) (aggregato Conto/ContoRiga), [ADR-0068](./ADR-0068-operativita-comande.md) (operatività + pricing resolver), [ADR-0069](./ADR-0069-kds-layer-comanda.md) (layer Comanda/KDS)

## Context

Uno STOP 0 sul dominio ristorazione ha fatto emergere due buchi accoppiati, invisibili finché non esisterà la cassa:

**A. La semantica lordo/netto dei prezzi non esiste — è assente, non indecisa.** Nessun commento su `Article.basePrice`/`ArticlePrice.price`/`ContoRiga.prezzoUnitario`, nessun ADR, nessun codice che la implichi. `computeTotale` somma `prezzoUnitario × quantita` ignorando l'IVA. `Article.vatPercent` (`Int`, 4/10/22) è memorizzato ma **mai letto da nessuno** (solo CRUD/audit). Nessun codice dipende dalla risposta → si decide ora, senza retrocompatibilità.

**B. `ContoRiga` non snapshotta l'aliquota.** Congela `nomeArticolo`, `prezzoUnitario`, `reparto` (DP-C, ADR-0067), ma non `vatPercent`. Incoerenza latente: cambiare l'aliquota di un articolo altererebbe retroattivamente lo scorporo dei conti già chiusi. Non si vede oggi perché nessuno scorpora; si vedrà quando esisterà la cassa — e allora sarà tardi per i dati già scritti.

## Decision

### D1 — Prezzi **lordi** (IVA inclusa)

`Article.basePrice`, `ArticlePrice.price`, `ContoRiga.prezzoUnitario` sono **lordi, IVA inclusa**. `Conto.totale` = Σ (`prezzoUnitario` × `quantita`) = **importo che il cliente paga**, nessuna IVA da aggiungere.

**Motivazione:**

- Ristorazione B2C in Italia: il prezzo di carta è quello che il cliente paga, IVA inclusa; il totale del conto è la somma dei prezzi di carta.
- L'alternativa (netto + IVA a valle) è il modello B2B e produrrebbe un totale ≠ dalla somma dei prezzi esposti — sbagliato per un ristorante.
- `vatPercent` separato per-articolo è il setup per lo **scorporo** posteriore (estrarre l'imponibile dal lordo), non per una somma. Coerente con `ArticlePrice` (_"IVA è proprietà Article, non varia per listino"_).

**Conseguenza esplicita:** `computeTotale` **non cambia** — resta somma lorda pura. Lo scorporo imponibile/IVA per aliquota è responsabilità della **cassa**, differito.

### D2 — Snapshot `vatPercent` su `ContoRiga` (NOT NULL)

`ContoRiga.vatPercent`, tipo **`Int`** identico a `Article.vatPercent`, **NOT NULL**. Popolato a runtime da `resolveLineSnapshot` (snapshot da `Article.vatPercent`, congelato all'ordine come nome/prezzo/reparto).

NOT NULL e non nullable: una riga senza aliquota è un dato che la cassa non saprà trattare. Meglio un backfill dichiarato che un campo opzionale che si propaga a valle.

**Nessun consumer in questa PR — deliberato, NON build speculativo (Pattern 43).** Un dato di _snapshot_ va catturato quando esiste, non quando serve: aspettare il consumer (coperto, varianti prezzate, cassa) significa perdere i dati intermedi. È prerequisito, non feature.

### D3 — Backfill best-effort sulle righe pre-migration

`ContoRiga.articleId` è FK required → il backfill dall'aliquota **corrente** dell'articolo è sempre risolvibile (verificato: 0 orfani, 0 articoli con `vat_percent` NULL in produzione). **Limite dichiarato:** l'aliquota vigente al momento dell'ordine non è ricostruibile (mai salvata) → le righe pre-migration ricevono l'aliquota corrente (best-effort); dal deploy in poi il valore è uno snapshot vero. Accettabile: i dati esistenti sono demo, non contabilità reale.

**Invariante di deploy (verificato CI+prod, throwaway 2-tenant RLS FORCE):** la `UPDATE` di backfill è cross-tenant e `conti_righe` ha RLS `FORCE` → tocca tutte le righe **solo perché le migration girano come `DIRECT_URL = postgres`** (`rolsuper=t`, `rolbypassrls=t`; Prisma usa `directUrl` per le DDL). Sotto l'app role `gestionale_app` (NOSUPERUSER/NOBYPASSRLS, nessun `app.tenant_id`) la stessa `UPDATE` tocca **0 righe** → il `SET NOT NULL` fallirebbe. **Vale per ogni futura data-migration cross-tenant:** dipende da `DIRECT_URL` = superuser. Non puntare `DIRECT_URL` all'app role.

## Confini / Fuori scope (con trigger)

- **Scorporo imponibile/IVA, documento commerciale, RT.** _Trigger = blocco CASSA pre-fiscale._
- Coperto e varianti prezzate (che erediteranno lo stesso problema aliquota) — STOP 0 dedicati, questo ADR ne è il prerequisito dati.

## Consequences

- ✅ La semantica prezzi è ora esplicita e documentata (era assente): lordo, totale = somma pura.
- ✅ L'aliquota è congelata sulla riga → lo scorporo futuro sarà storicamente corretto dai dati scritti dal deploy in poi.
- ⚠️ Le 6 righe demo pre-migration hanno aliquota best-effort (corrente ≠ ordine) — irrilevante (demo).
- ⚠️ `computeTotale` intenzionalmente invariato: chi cercherà lo scorporo qui non lo troverà — è alla cassa (differita).
