# ADR-0065 — Triage TD residui ADR-0044: deferral con trigger esplicito

**Status:** Accepted
**Date:** 2026-07-01
**Related:** ADR-0044 (modulo Documenti), ADR-0046 (portale cliente), ADR-0063 (tiering STOP-gate)

## Context

Tre TD residui nascevano tutti da ADR-0044 (2026-06-20): `TD-documenti-tipo-codice`, `TD-utente-enum-forward`, `TD-storage-gc`. Erano registrati genericamente come "debito da ripagare".

Una verifica empirica read-only (STOP 0, cross-codebase) ha ribaltato quella lettura:

- **Tutti e tre sono tier alto** (toccano schema/migration condivisa, security live, o cancellazione irreversibile): nessuno è un fix meccanico da sgombrare in fretta.
- **Due dei tre sono feature deferred in attesa di trigger, non debito**: il loro consumer non esiste in codice.
- **Uno è un item ops reale**, ma richiede un sottosistema nuovo.

Applicando YAGNI / Pattern 43 (non costruire senza un consumer reale): aggiungere ora ciò che nessuno utilizza è debito additivo, non risoluzione di debito.

## Decision

### TD-documenti-tipo-codice → DEFERRED (trigger-gated)

`DocumentoTipo` funziona interamente a `nome` (matching/idempotenza per nome, 0 consumer di un codice macchina). Il trigger dichiarato — fase 6C (questionari / `documenti_tipi_campi` che referenziano i tipi per codice stabile) — **non esiste in codice** (unico match = un commento).
**Non si aggiunge** il codice macchina finché 6C non introduce un consumer reale. Fix futuro (quando triggato): 1 colonna nullable + backfill dei 16 tipi platform nel seed. Tier alto (schema+migration+seed su DB condiviso).

### TD-utente-enum-forward → DEFERRED (trigger-gated, security-sensitive)

Premessa dell'ADR-0044 superata dai fatti: il portale cliente (ADR-0046) è **live e funzionante** con ACL **per-ruolo** (`VisibilitaDocumento {tutti, azienda}`), non per-utente. Il targeting per singolo utente-cliente non è mai stato richiesto.
**Non si tocca** l'enum condiviso né il predicato ACL `clienteWhere` (superficie di sicurezza in produzione) per abilitare un requisito che nessun consumer esprime. Trigger futuro: una richiesta reale di targeting documenti per singolo utente-cliente. Tier alto (enum su schema condiviso + migration + modifica ACL portale live).

### TD-storage-gc → BACKLOG OPS ATTIVO (non trigger-gated)

Il pattern soft-delete-keeps-file è **intenzionale e corretto**. Ma gli orfani su storage **si accumulano realmente** → è un item ops legittimo, non un fantasma. `StorageService.delete()` esiste ed è coperto da test, ma oggi ha 0 chiamanti; una GC ne sarebbe il primo consumer. Richiede un sottosistema nuovo (cron da zero: `@nestjs/schedule` assente) con cancellazione file **irreversibile**.
**Resta nel backlog ops** come lavoro reale futuro, tier alto, da schedulare quando l'accumulo giustifica l'attenzione. Nessuna urgenza dimostrata al momento.

## Consequences

- La voce generica "TD residui accountant" si **chiude**: sostituita da 2 deferred-con-trigger + 1 backlog ops esplicito. Rumore ridotto.
- I trigger sono **condizioni verificabili in codice** (esistenza consumer), non date arbitrarie: quando il trigger comparirà, il TD si riattiva automaticamente con contesto già scritto.
- Nessun codice, schema o test modificato da questa decisione: è puro triage documentale.
- I due deferral non sono "won't-fix" definitivi: sono "not-yet, per assenza di consumer". La distinzione è deliberata.
