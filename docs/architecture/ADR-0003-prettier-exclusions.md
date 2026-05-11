# ADR-0003 — Esclusione documenti narrativi del progetto da Prettier

- **Status:** Accepted
- **Date:** 2026-05-11
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** `PROJECT_BRIEF.md` §C12 (ESLint + Prettier obbligatori), `.prettierignore`

## Context

Il brief §C12 stabilisce che ESLint e Prettier sono obbligatori in CI: ogni file
del repository deve essere stilisticamente conforme. La conseguenza meccanica è
che anche i file Markdown vengono validati da `prettier --check`.

Nel repository esistono tre file Markdown con uno status particolare:

- `PROJECT_BRIEF.md` — fonte di verità del progetto (architettura, scope, fasi)
- `PROGRESS.md` — stato corrente e prossimi task, aggiornato dopo ogni macro-task
- `STARTER_PROMPT.md` — protocollo operativo per ogni sessione AI

Sono **strumenti operativi del progetto**, non codice di dominio. Hanno
caratteristiche che mal si sposano con Prettier:

- **tabelle "wide"** con colonne strutturate manualmente per leggibilità
- **liste articolate** con indentazione semantica intenzionale
- **paragrafi lunghi** che `printWidth: 100` spezzerebbe in righe corte,
  perdendo coesione narrativa
- vengono **modificati a quattro mani** (Nicolò + AI strategica) con uno stile
  uniforme già consolidato; non c'è il problema "ogni contributor formatta
  diverso" che Prettier risolve sui sorgenti

## Decision

I tre file vengono aggiunti a `.prettierignore`:

```
PROJECT_BRIEF.md
PROGRESS.md
STARTER_PROMPT.md
```

Tutti gli altri file Markdown (README.md, ADR in `docs/architecture/`, docs
tecniche future) restano sotto il regime Prettier standard.

## Consequences

### Positive

- ✅ Nessun rischio che Prettier rompa tabelle wide o spezzi righe a 100ch
  in paragrafi narrativi.
- ✅ Struttura manuale dei tre documenti preservata indefinitamente.
- ✅ Il check CI `format:check` rimane veloce e non genera falsi positivi
  ogni volta che si aggiorna PROGRESS.

### Negative / Trade-off

- ⚠️ I contributor (umani o AI) devono mantenere consistenza stilistica
  manualmente sui tre file. **Impatto basso**: gli update sono pochi, sempre
  via AI strategica con stile coerente, e i file non sono codice eseguibile
  quindi un'eventuale inconsistenza visiva non rompe nulla.
- ⚠️ Divergenza esplicita dal principio "Prettier copre tutto" del brief
  §C12. Mitigata da questo ADR.

### Neutral

- README.md, gli ADR in `docs/architecture/` e tutta la documentazione
  tecnica futura restano sotto Prettier — quindi la disciplina di stile
  resta in piedi sui documenti "codice del progetto".

## Considered Alternatives

### 1. Prettier su tutti i .md (no esclusioni)

- ✅ Massima coerenza stilistica automatica.
- ❌ Rischio concreto di rovinare tabelle wide (`PROJECT_BRIEF.md` ne ha
  diverse). Verificato empiricamente: il primo `pnpm format:write` ha
  ricalibrato il padding delle tabelle di `README.md`; su file più strutturati
  l'effetto sarebbe più invasivo.
- ❌ Ogni update a PROGRESS richiederebbe di girare `format:write` per non
  rompere CI — frizione su un file modificato spesso.

### 2. Tag inline `<!-- prettier-ignore -->`

- ✅ Granularità chirurgica: ignora solo il blocco problematico.
- ❌ Verboso e fragile su file lunghi con molte tabelle/liste — significa
  cospargere il file di commenti tecnici.
- ❌ Non risolve il problema dei paragrafi narrativi rewrappati.

### 3. Config Prettier custom per i .md (printWidth elevato, noWrap)

- ✅ Tecnicamente possibile via overrides nel `.prettierrc.json`.
- ❌ Complessità non giustificata: aggiunge un livello di config per
  esentare solo tre file. Lo stesso effetto si ottiene con due righe in
  `.prettierignore`.

## Reversibility

Se in futuro decidiamo di standardizzare tutti i Markdown:

1. Rimuovere le tre righe da `.prettierignore`
2. Eseguire `pnpm format:write` (riformatta i tre file in un colpo solo)
3. Aggiornare/superare questo ADR

L'operazione è meccanica e non distruttiva (gli edit Prettier sono
cosmetici, mai semantici).

## Notes

- La decisione è stata presa durante la sessione 2026-05-11 di setup CI/CD,
  dopo aver rilevato che `prettier --check` segnalava i tre file come
  non conformi e aver valutato l'impatto di un `format:write` sui contenuti
  narrativi.
- Il commento esplicativo dentro `.prettierignore` rimanda a questo ADR
  per chiunque ispezioni il file in futuro.
