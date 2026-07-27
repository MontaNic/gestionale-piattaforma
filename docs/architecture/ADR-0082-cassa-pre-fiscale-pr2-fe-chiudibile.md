# ADR-0082 — Cassa pre-fiscale PR2: vista dedicata, `chiudibile` come contratto, UX del residuo negativo

- **Status:** Accepted
- **Date:** 2026-07-27
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0081](./ADR-0081-cassa-pre-fiscale-pr1-pagamenti.md) (pagamenti, saldo derivato, guardia di chiusura — **prerequisito diretto**), [ADR-0068](./ADR-0068-operativita-comande.md) (operatività + state machine), [ADR-0070](./ADR-0070-prezzi-lordi-snapshot-aliquota-riga.md) (prezzi lordi + snapshot aliquota), [ADR-0067](./ADR-0067-modello-aggregato-conto.md) (aggregato Conto/ContoRiga)

## Context

PR1 ha chiuso schema e BE della cassa: pagamenti come child table, `residuo`/`statoPagamento`/`riepilogoIva` derivati, guardia di saldo su `chiudi`. La UI non esisteva: `/cassa` era una `PlaceholderPage` di 4 righe e i 3 permessi `cassa.*` enforced non avevano **nessun consumer FE**.

Uno STOP 0 read-only ha fotografato il divario:

- `GET /conti/:id` restituiva già `pagamenti[]`, `residuo`, `statoPagamento`, `riepilogoIva` e `riepilogoIvaSnapshot`, ma il tipo FE `ContoWithRighe` si fermava a `righe` + `totale`: i campi cassa **transitavano non tipizzati e non normalizzati** (`residuo` restava la stringa raw del Decimal).
- `packages/api-client` è generico (verbi HTTP + `ApiError`): il dominio conti vive in `apps/restaurant-web/src/lib/conti-api.ts`, dove **nessuna delle 3 rotte cassa** era presente.
- **8 error code** emessi dal BE non avevano messaggio IT e cadevano sul fallback generico — fra cui `E_CONTO_NOT_SETTLED`, già raggiungibile dal bottone "Chiudi" di `comande/[contoId]` **dalla PR1**: il cambio di contratto D3 era arrivato in UI come "Si è verificato un errore. Riprova."
- Il contratto **non esponeva alcun predicato di chiudibilità**: il predicato viveva solo dentro `assertSettled`, privato, a forma di `throw`.

L'ultimo punto è quello che ha deciso la PR.

## Decisioni

### D1 — Vista cassa dedicata, non un pannello dentro comande

`/cassa` (index dei conti aperti) + `/cassa/[contoId]` (pannello di pagamento). `comande/[contoId]` resta la vista di **gestione** (righe, invio, annulla) e guadagna solo un bottone "Incassa" verso la cassa.

**Motivazione:** sono due mestieri e spesso due persone. Il cassiere entra a fine servizio, sceglie il conto e incassa; non deve attraversare il picker articoli né poter toccare le righe. La separazione è anche quella già scelta dal BE, che ha tenuto `cassa.*` distinti da `comande.*` proprio perché un cassiere possa incassare senza avere i permessi comande (ADR-0081 D5). Un pannello dentro `comande/[contoId]` avrebbe rimesso insieme ciò che i permessi separano.

Nessun polling sulla vista cassa (a differenza di mappa e KDS): l'incasso è un'interazione in primo piano, non un display da muro. Refetch integrale dopo ogni mutazione — nessuna delle 3 rotte pagamento restituisce il conto aggiornato, e `getConto` è l'unica fonte di `residuo`/`chiudibile` freschi.

### D2 — `chiudibile: boolean` sul contratto, derivato dallo stesso predicato della guardia

`GET /conti/:id` espone `chiudibile`, calcolato da `isChiudibile(totale, pagato)` — la **stessa funzione** che `assertSettled` usa per emettere `E_CONTO_NOT_SETTLED`. Il FE lega il bottone "Chiudi conto" a quel campo e **non lo ricalcola mai**.

**Motivazione:** l'alternativa era derivarlo lato UI da `residuo === 0`. Sarebbe stato sbagliato in un caso reale e non ovvio — il conto **sovra-pagato** (`residuo < 0`, `totale > 0`, prodotto dallo storno di una riga già pagata) è `statoPagamento: 'saldato'` ma **non** è chiudibile. Una UI che deriva `residuo <= 0` mostra un bottone che il BE rifiuta con 409; una che deriva `residuo === 0` funziona finché qualcuno non "armonizza" i due predicati. Esporre il predicato come dato elimina la classe di bug invece di documentarla.

⚠️ **La divergenza fra i due predicati è voluta e va protetta.** `computeStatoPagamento` usa `residuo <= 0` (→ `saldato`), `isChiudibile` usa `isZero()` **stretto**. Unificarli rimetterebbe il sovra-pagato fra i chiudibili, cioè riaprirebbe esattamente la condizione che ADR-0081 D1 ha deciso di non modellare. Il divieto è scritto nel docstring della funzione e coperto da un unit test dedicato (`residuo < 0 && totale > 0 → false`) e da un e2e che verifica **il campo e l'esito reale di `chiudi` nella stessa prova**: se divergessero, il test cade.

Additivo puro: nessuna migration, nessun permesso nuovo, `assertSettled` refactorata a comportamento e throw identici.

### D3 — Il residuo negativo si dice, non si nasconde

Tre stati, tutti parlanti, **nessun bottone disabilitato in silenzio**:

| condizione                   | UI                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `chiudibile`                 | "Conto saldato: puoi chiuderlo." + **Chiudi conto**                                  |
| `!chiudibile && residuo > 0` | "Restano € X da incassare prima di poter chiudere" — la CTA è il blocco pagamento    |
| `!chiudibile && residuo < 0` | riquadro **sovra-pagato** con causa e via d'uscita (storna e ri-registra, o annulla) |

**Motivazione:** il limite D3 di ADR-0081 è dichiarato ma **non è intuibile** da chi sta in cassa: il conto dice "saldato" e non si chiude. Un bottone grigio senza spiegazione avrebbe prodotto esattamente la chiamata di supporto che l'ADR precedente si era impegnata a evitare. Il terzo caso è raro e per questo va spiegato **dove capita**, non in un runbook.

Corollario: su residuo negativo la didascalia di `statoPagamento` ("nulla da incassare") viene **soppressa** — accanto a un `€ -6.50` si legge come una contraddizione. Lì parla il riquadro sovra-pagato.

### D4 — Metodo segmentato, importo pre-compilato, split come lista; resto differito

Metodo di pagamento = 3 `Button` segmentati (contanti/carta/altro), non un `<select>`: la cassa è touch e il set è chiuso e minuscolo — tre target grandi battono un menu a tendina di tre voci. Importo pre-compilato col **residuo** e riallineato a ogni load: il caso dominante è "paga tutto", il parziale è l'eccezione che si edita.

Lo split payment è già nativo lato dati (ADR-0081 D1) e in UI è semplicemente la **lista** dei pagamenti registrati, ognuno con il proprio storno. Nessun wizard "vuoi dividere il conto?": si registra un pagamento, resta un residuo, se ne registra un altro.

Il cap sull'importo è **solo UX** (submit disabilitato + messaggio): l'autorità resta il BE. Se il residuo cambia sotto — altro operatore sullo stesso conto — arriva `E_PAGAMENTO_EXCEEDS_RESIDUO` e viene mostrato.

**Resto contanti differito** (`TD-cassa-resto-drawer`, già registrato in PR1): `importo` è quanto viene **applicato al conto**, non quanto il cliente porge. Il trigger resta quello di ADR-0081 — la riconciliazione del cassetto.

### D5 — L'index cassa non mostra importi

`/cassa` elenca i conti aperti con canale/tavolo/coperti, **senza totale né residuo**: `GET /conti` restituisce il `Conto` flat, che non li espone (li deriva solo `GET /conti/:id`). Mostrarli significherebbe N fetch per-conto al mount.

🆕 **`TD-conti-list-amounts`** — **trigger:** il cassiere deve prioritizzare i conti per importo a colpo d'occhio dall'index. La soluzione (derivare gli aggregati nella `list` con una query aggregata, non N+1) si progetta quando quel bisogno è reale: farlo ora significherebbe scegliere la forma dell'aggregato senza il consumer che la definisce.

### D6 — Consolidamenti raccolti in PR

- `formatEuro` estratta in `lib/format.ts` — nasceva duplicata per-pagina e con la cassa i punti di render monetari passano da 5 a ~15. Resa invariata (`€ 8.00`, niente `Intl`: cambierebbe separatore e posizione del simbolo rispetto a quanto è già a schermo).
- **+8 messaggi IT** per gli error code che cadevano sul generico. `E_CONTO_NOT_SETTLED` ora dice _cosa fare_ ("incassa il residuo, oppure annulla"), non solo che è andata male.
- **Smoke paga-poi-chiudi** (`cassa-flow.spec.ts`), la variante che ADR-0081 aveva esplicitamente demandato a questa PR.

## Superficie

**BE** (additivo, nessuna migration): `isChiudibile(totale, pagato)` esportata da `conti.service.ts`; `assertSettled` delega; `ContoWithRighe.chiudibile`.

**FE**:

- `conti-types.ts`: `ContoWithRighe` +`pagamenti`/`residuo`/`statoPagamento`/`riepilogoIva`/`chiudibile`; `Conto` +`riepilogoIvaSnapshot`; nuovi `Pagamento`, `MetodoPagamentoConto` + `METODI_PAGAMENTO`, `StatoPagamento`, `RiepilogoIvaGruppo` (+ Raw), `RegistraPagamentoInput`.
- `conti-api.ts`: `listPagamenti` / `registraPagamento` / `stornaPagamento`; mapper estesi (`residuo` e `pagamenti[].importo` → number come `totale`). `statoPagamento` e `chiudibile` passano **intatti**: sono autoritativi. `riepilogoIvaSnapshot` resta stringa nel dominio (fotografia fiscale), convertito solo al render.
- Pagine `cassa/page.tsx` (index) e `cassa/[contoId]/page.tsx` (pannello); `comande/[contoId]` +bottone "Incassa" gated `cassa.visualizza`.
- i18n: namespace `cassa` (it/en) + `comande.detail.incassa`.

**Permessi: invariati (64).** Nessun permesso nuovo. Gating FE: pagina su `cassa.visualizza`, pagamento su `cassa.pagamento.registra`, storno su `cassa.storno.esegui`, chiusura su `comande.modifica` (la rotta non ha cambiato permesso in PR1).

**Nota sul gate di pagina:** `/cassa` e `/cassa/[contoId]` sono gated `cassa.visualizza`, ma i loro fetch (`GET /conti`, `GET /conti/:id`) stanno su `comande.visualizza`. Un utente con `cassa.*` e **senza** `comande.visualizza` vede il messaggio del 403, non una lista vuota. È coerente con ADR-0081 D5 (permessi indipendenti per scelta) e nessun template di ruolo seedato si trova in quella combinazione.

## Isolamento della smoke dai tavoli seedati

`cassa-flow.spec.ts` **crea ed elimina un proprio tavolo** invece di prenderne uno dei 2 seedati. Il vincolo DP-2 "un tavolo, un conto aperto" rende il tavolo una risorsa **esclusiva**, e il pool era già conteso: `coperti-warning.spec.ts` apre un conto e non lo chiude (occupa un tavolo in modo permanente), `comande-flow.spec.ts` prende il primo libero. Con `fullyParallel` in locale le due spec flow finivano sullo **stesso** conto e si annullavano il lavoro a vicenda — osservato, non ipotizzato. Il tavolo dedicato rimuove la contesa senza toccare le spec esistenti né il seed.

## Consequences

- ✅ La cassa è usabile end-to-end dalla UI: incasso singolo e split, storno, chiusura con riepilogo IVA congelato a schermo.
- ✅ I 3 permessi `cassa.*` enforced hanno un consumer FE reale.
- ✅ Il limite D3 di ADR-0081 non è più un vicolo cieco muto: `chiudibile` lo rende leggibile lato UI e il riquadro sovra-pagato ne spiega l'uscita. **Il limite resta** — questa PR non lo rimuove, lo rende comprensibile.
- ✅ `E_CONTO_NOT_SETTLED` ha un messaggio utile anche sul vecchio path (`comande/[contoId]` → Chiudi), dove dalla PR1 era un errore generico.
- ⚠️ `chiudibile` è una **fotografia al momento del GET**: se un altro operatore paga o storna nel frattempo, il bottone può essere stale fino al refetch. Il BE resta la guardia (409), il messaggio ora è parlante. Nessun polling: se il pilota reale lavora in due sullo stesso conto, il trigger per aggiungerlo è quello.
- ⚠️ L'index cassa non mostra importi (D5, `TD-conti-list-amounts`).
- ⚠️ Il resto contanti continua a non esistere (`TD-cassa-resto-drawer`, PR1).
- 🆕 `TD-conti-list-amounts` — **trigger:** prioritizzare i conti per importo dall'index cassa.

## Fuori scope (con trigger)

- **RT / certificazione fiscale, scontrino.** _Trigger = cliente reale._ `cassa.scontrino.emetti` resta il segnaposto.
- **Chiusura giornaliera / Z-report.** _→ ADR-0081 D6, `TD-cassa-chiusura-giornaliera`._
- **Tastierino numerico e resto.** _→ `TD-cassa-resto-drawer`; il campo importo con `inputMode="decimal"` copre il caso tablet finché il resto non è persistito._
- **Conto separato / split per persona.** Non richiesto dal pilota; lo split **per metodo** è coperto.

## Impatto sull'altro verticale

**Verificato.** `chiudibile` è un campo derivato in memoria dentro `apps/restaurant-api`: **nessuna modifica a `packages/db`**, allo `schema.prisma` o al seed → migration **N.A.**, propagazione permessi **N.A.** Le viste vivono in `apps/restaurant-web`. Grep a zero occorrenze di `chiudibile`/`Pagamento`/`cassa.` in `apps/accountant-api` e `apps/accountant-web`. `packages/api-client` (condiviso) **non toccato**: le 3 funzioni nuove stanno nel layer di dominio di restaurant-web.
