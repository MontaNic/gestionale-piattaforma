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
CHIUSURA SESSIONE — [data]

- Passo affrontato: [....]
- Cosa fatto: [package creato, file spostati, test aggiunti...]
- PR: #[numero] — stato: [aperta / mergiata]
- Gate: lint [..] / typecheck [..] / test [..] / Playwright [..] / next build [..]
- Decisioni prese in sessione: [....]
- Sorprese / scoperte: [....]   ← anche le stime sbagliate, dichiarate
- Tech-debt o note registrate: [....]
- Checkpoint: [commit/tag]   PROGRESS aggiornato: [sì/no]
- PROSSIMO PASSO: [....] con criteri di completamento: [....]
- Cosa serve da Nicolò prima di proseguire: [....]
```

---

## Nota

Questo documento è un riassunto operativo, non la fonte di verità. La verità resta in `PROGRESS.md`, negli ADR e nella storia git. Se questo file e il PROGRESS divergono, vince il PROGRESS — e va corretto.
