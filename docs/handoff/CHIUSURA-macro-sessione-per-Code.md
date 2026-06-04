# CHIUSURA MACRO-SESSIONE — per Claude Code

> **A cosa serve:** riassunto da scrivere/aggiornare alla fine di una tornata di lavoro con Claude Code, e da rileggere all'inizio della successiva. Si appoggia ai file di verità del repo (non sostituisce PROGRESS/ADR: li riassume e indica il prossimo passo). Tienilo nel repo, es. `docs/handoff/`.

---

## Blocco di apertura sessione Code (da incollare a Code a inizio sessione)

```
Riprendiamo l'estrazione del core. Leggi PRIMA, in quest'ordine:
docs/architecture/ADR-0025, ADR-0027 (e ADR-0026 per il data layer), PROGRESS.md, STARTER_PROMPT.md.

Conferma in 5 righe: ultimo passo mergiato, passo corrente e suoi criteri di completamento,
decisioni già prese da non rimettere in discussione. NON scrivere codice finché non confermo.

Regole attive:
- Un passo per PR; gate = test verdi costanti + CI verde prima del merge.
- Confine core/dominio (ADR-0027): si estrae ciò che è agnostico al verticale; ciò che nomina
  entità di dominio (Menu/Articolo/Comanda...) resta in apps/web o apps/api.
- Packaging: solo-Next → transpilePackages; consumato anche da apps/api → dual-package tsup.
  I dual-package consumati da apps/api vanno aggiunti allo step "Build workspace packages"
  del job e2e-playwright in ci.yml (gira fuori da Turbo).
- Niente "miglioramenti" non richiesti durante un'estrazione (es. tech-debt storage token):
  comportamento identico, il tech-debt si affronta nel suo task.
- Se un test (specie Playwright auth o RLS) diventa rosso: fermati, NON aggiustare al volo.
- Le tue conclusioni vengono verificate (es. diagnosi "crash produzione" rivelata falsa):
  riporta i fatti, non archiviare ipotesi come certezze.
- A fine sessione: killa i dev server (porte 3000/3001).
- Apri la PR con `gh pr create` (gh ora disponibile).
```

---

## Blocco di chiusura sessione (da far scrivere a Code, o scrivere tu, a fine sessione)

```
CHIUSURA SESSIONE — 2026-06-04

- Passo affrontato: estrazione core passo 5 (5a packages/api-client + 5b packages/auth-web, ADR-0027 §D5)
- Cosa fatto: estratti 2 package — api-client (client HTTP generico: apiGet/apiPost/apiPatch/
  apiDelete + ApiError + RequestOptions) e auth-web (AuthContext/AuthGate/auth/auth-logout/types).
  Consumer ripuntati ai package; test aggiunti (10 api-client + 12 auth-web). Installato gh CLI
  sul server (PR ora apribili da terminale).
- PR: #50 (api-client) MERGED @ b93aa9e · #51 (docs/handoff templates) MERGED @ 32f3cb9 ·
  #52 (auth-web) MERGED @ 9a2198b
- Gate ultima PR (#52): lint 0 / typecheck 10/10 / test 139 in 18 file / Playwright chromium 14/14 /
  next build (da .next pulito) ok
- Decisioni prese in sessione:
  · api.ts è infra HTTP condivisa (consumata anche dal dominio) → estratta come packages/api-client
    in un passo 5a separato (deviazione d'ordine rispetto ad ADR-0027 §D5, annotata in PROGRESS),
    così auth-web la consuma senza accoppiare il dominio ad "auth-web".
  · auth-web dipende SOLO da @gestionale/api-client (+ peerDeps react/react-dom/next), NON da
    @gestionale/shared: i 5 file non importano error-codes (usano ApiError da api-client).
  · il path /t/<slug> resta dentro auth-web come convenzione di routing della piattaforma (TD-2).
- Sorprese / scoperte:
  · middleware.ts NON contiene logica auth (l'auth FE è interamente client-side) → resta in apps/web
    (slug-routing dominio + locale guard i18n), niente da estrarne.
  · grafo dipendenze di auth-web più pulito dell'atteso: nessuna dipendenza da shared (smentita
    l'ipotesi iniziale del prompt che prevedeva il consumo di error-codes da shared).
- Tech-debt o note registrate:
  · nota di parametrizzazione futura: lo schema URL /t/<slug>/login assunto da AuthContext/AuthGate
    è da parametrizzare al 2° verticale con schema diverso (registrata in PROGRESS + barrel del package,
    NON è un task ora).
  · TD-1 (token in localStorage) non toccato: estratto com'è, comportamento identico.
  · lezione gh pr merge --auto: mergiare solo a CI verde, evitare il merge su check pending
    (come capitato con #52).
- Checkpoint: main @ 9a2198b   PROGRESS aggiornato: sì (sezione passo 5b + nota parametrizzazione)
- PROSSIMO PASSO: passo 6 — packages/platform (BE infra: redis/mail/throttler/health/common).
  Criteri di completamento: package estratto, gate verde costante, comportamento backend INVARIATO.
  ⚠️ Da qui inizia il BACKEND: rientra il build-order CI — i package dual-package (tsup) consumati
     da apps/api vanno aggiunti allo step "Build workspace packages" del job e2e-playwright in
     ci.yml (gira fuori da Turbo, quindi ^build non scatta). NB: api-client/auth-web/ui/i18n NON
     erano interessati perché consumati solo da Next via transpilePackages.
- PROMEMORIA passo 8 (packages/db): scrivere il test RLS core-only come gestionale_app NON-superuser
  PRIMA di toccare packages/db (ADR-0026 §D5: gli e2e attuali girano da superuser e quindi non
  esercitano la RLS a livello DB).
- Cosa serve da Nicolò prima di proseguire: conferma avvio passo 6 in una nuova sessione.
```

---

## Nota

Questo documento è un riassunto operativo, non la fonte di verità. La verità resta in `PROGRESS.md`, negli ADR e nella storia git. Se questo file e il PROGRESS divergono, vince il PROGRESS — e va corretto.
