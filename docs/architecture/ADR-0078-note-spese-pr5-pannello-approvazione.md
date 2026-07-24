# ADR-0078 — Note Spese v1 PR-5 (FE: pannello approvazione) — chiude il blocco

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [spec](../spec/note-spese-v1.md) §8/§6/§4, [ADR-0077](./ADR-0077-note-spese-pr4-ui-operatore.md) (UI operatore), [ADR-0076](./ADR-0076-note-spese-pr3-state-machine.md) (state machine)

## Context

Vista separata per chi **decide** (`notespese.approva`), distinta dall'UI operatore di PR-4. Consuma i 2 endpoint residui (`approva`, `respingi`) e **chiude Note Spese v1**. **Tier MEDIO** — `accountant-web` only.

**Prerequisito emerso in STOP 0 → PR-5a (#181)**: il payload esponeva solo `userId` (UUID) e l'unica lista utenti del tenant è `GET /tariffe/users`, gated su **`tariffario.gestisci`** — il permesso sui costi orari del personale, che la Direzione non ha. Il pannello avrebbe mostrato UUID grezzi e preso 403 sul filtro utente; agganciarlo a quel permesso sarebbe stato sbagliato nel merito. Chiuso con `list`/`getById` che includono `user` e `decisaDa` (select esplicito, mai `email`).

## Decisioni

- **Rotta separata** `/t/<slug>/approvazione-spese` (non una modalità della vista operatore), voce sidebar gated `notespese.approva`.
- **Coda di lavoro**: default `stato=inviata`. Filtri **stato/utente/periodo** mappati sui query param §6.
- **Opzioni del filtro utente derivate dagli autori in coda**, non da una lista di tutti gli utenti del tenant: l'insieme utile è quello, e non richiede una nuova superficie BE. Le opzioni si aggiornano solo a filtro utente vuoto, altrimenti collasserebbero all'unico selezionato.
- **Riga**: autore, data, tipo, totale, azienda/mandato, presenza allegati, stato, **scopo** (aggiunto oltre l'elenco §2: per decidere serve il contesto, ed è coerente con la riga operatore).
- **Dettaglio con allegati scaricabili**: un approvatore che non può vedere il giustificativo non può decidere.
- **Auto-decisione**: le azioni **non si mostrano** sulle proprie note, con messaggio che spiega perché — non basta gestire l'errore.
- **`approva`** ha conferma esplicita (`approvata` è terminale). **`respingi`** ha motivo obbligatorio validato prima dell'invio; il dialog dichiara che l'autore lo leggerà per correggere.
- **Dopo la decisione: refetch**, non rimozione ottimistica — la coda va riallineata comunque e in caso di race mostra lo stato vero.
- **`approva` senza `leggi_tutte`**: stato esplicito che spiega cosa manca, invece di una lista vuota muta (il BE forzerebbe `userId=self` e quelle note non sono decidibili). Non è il template di default, ma i ruoli sono personalizzabili per tenant.

## Nessun errore silenzioso (vincolo esplicito della spec)

`TD-fe-errori-silenziati` era appena stato registrato: PR-5 non doveva aggiungerne un settimo caso. Ogni azione (approva, respingi, download) mostra un messaggio comprensibile via `messageForError`; l'unico `.catch` non parlante è il prefetch best-effort dei lookup azienda/mandato — **non un'azione utente** — annotato al call-site.

**Il difetto che il GATE ha trovato è proprio di questa famiglia, e non era un catch mancante.** `eseguiDecisione` scriveva l'errore in `loadError`, poi il `finally` faceva il refetch e `load()` **inizia con `setLoadError(null)`**: il messaggio veniva cancellato un istante dopo essere stato scritto. Il `try/catch` c'era, `messageForError` c'era, nessuna unhandled rejection — **nessun grep l'avrebbe trovato**. Corretto con uno stato `azioneError` separato che il refetch non tocca.

→ **Conseguenza per `TD-fe-errori-silenziati`**: il debito non è solo "catch vuoti" (grep-abile) ma anche **errori scritti e poi sovrascritti da un reload**. Quando il TD verrà affrontato, il censimento va esteso a ogni `catch` che imposta uno stato d'errore condiviso con una funzione di refetch.

## GATE runtime (dev Sub-B, mai prod)

Ruolo **Direzione non-superuser** (seedato solo sul dev DB 55432, nessuna modifica al seed del repo), browser reale:

- coda con **autore visibile**, filtri stato/utente/periodo, nav gated → ok;
- **esclusione auto-decisione**: sulla nota della Direzione nessun bottone + messaggio → ok;
- **respingi con motivo**: conferma disabilitata a motivo vuoto, decisione registrata → ok;
- **l'autore vede il motivo** nella UI operatore (PR-4), nota in stato Respinta → ok (catena end-to-end fra le due viste);
- **race provocata davvero**: nota decisa via API alle spalle, poi click Approva → **409** → messaggio "già stata decisa da un altro utente" + lista aggiornata → ok;
- zero `pageerror`.

### Debito di metodo emerso (vale oltre questa PR)

Il primo tentativo di GATE stava per dare un **falso segnale**: il server su :3002 rispondeva e loggava, ma serviva codice **antecedente a PR-5a** (`allegati` presenti, `user` assente). Erano **processi `accountant-api` orfani** di run precedenti che tenevano la porta; il server nuovo non riusciva a bindare e moriva, quindi `--respawn` e `touch` non avevano effetto. Il check di cleanup con `sudo ss -tlnp | grep :3002` non mostrava PID e l'assenza di output era stata scambiata per verifica.

**Stessa famiglia di `TD-db-dist-stale-runtime`**: ciò che gira non è ciò che hai scritto. **Contromisura adottata**: prima di fidarsi di un GATE runtime, verificare che il server in esecuzione contenga un **marcatore della modifica più recente** (qui: il campo `user` nel payload).

## Consequences

- **Positive**: Note Spese v1 **completa** (schema + CRUD/storage + state machine + UI operatore + approvazione). Il pannello stabilisce il precedente corretto sugli errori: il modulo più nuovo non eredita il difetto.
- **Costi/rischi**: il filtro utente mostra solo gli autori presenti in coda — corretto per l'uso, ma non permette di cercare un utente senza note nel periodo. La dipendenza `approva`+`leggi_tutte` resta implicita nel modello permessi: gestita in UI, non risolta a livello di ruoli.
