# ADR-0086 — Il rollback point è una coppia (tag + divieto di prune) ed è un passo bloccante del deploy

**Stato**: Accettato
**Data**: 2026-07-30
**Contesto d'origine**: finestra di deploy S21 (design seam #189 + P2 #190-#193, `main` @ `cf0e521`)
**Correlati**: [ADR-0079](ADR-0079-storage-persistente-provenienza-immagini.md) (provenienza immagini, label OCI), [`docs/runbook-deploy-infrastrutturale.md`](../runbook-deploy-infrastrutturale.md) Passo 2

---

## Contesto

Fino a S21 il rollback point era trattato come una **raccomandazione**: «annota i digest / tagga le immagini prima del build». Il runbook lo descriveva, ma niente impediva di aprire il build senza averlo fatto, e la sua efficacia non era mai stata verificata — solo asserita.

Il preflight di S21 ha trovato lo stato reale: le quattro immagini in esercizio erano taggate **solo `:latest`**. I tag `rollback-*` esistenti puntavano tutti a image ID diversi, residui di finestre precedenti. In altre parole: dal deploy della cassa (27/07) fino al 29/07 la produzione **non aveva alcun rollback point**, pur avendo un runbook che lo prescriveva.

La causa non è disattenzione dell'operatore. È che il presidio era formulato come intenzione ("ricordarsi di taggare") invece che come passo con una verifica di efficacia — la stessa classe di difetto già registrata per i presidi che dipendono da risorse non governate.

## Decisione

**Il rollback point è una coppia inseparabile di due presidi, ed è un passo bloccante: il build non parte se la verifica di efficacia non produce l'output atteso.**

1. **Tag espliciti sulle immagini in esercizio**, applicati **per image ID rilevato dai container in esecuzione** — mai per `:latest`, che al momento del tag può già puntare altrove.
2. **Divieto di prune di qualsiasi tipo** (`docker system prune`, `docker image prune -a`, `docker builder prune -a`) fino alla chiusura della finestra, intesa come merge della PR di documentazione e non come fine del rollout.
3. **Verifica di efficacia obbligatoria**: la label OCI `org.opencontainers.image.revision` dell'immagine taggata deve corrispondere — **a prefisso** — al suffisso del tag. Senza questo output, il build non si apre.
4. **Secondo controllo dopo il build, prima del rollout**: i tag di rollback devono essere ancora tutti presenti.

## Perché una coppia, e non due voci separate

Perché nessuno dei due presidi basta da solo, e — questo è il punto non ovvio — **quale dei due sta effettivamente lavorando cambia durante la finestra**. Sono due regimi:

| Momento             | Chi tiene in vita il rollback                        | Il tag è…                  | Il divieto di prune è…               |
| ------------------- | ---------------------------------------------------- | -------------------------- | ------------------------------------ |
| Prima del cutover   | i container in esecuzione, che ancorano gli image ID | ridondante                 | quasi ridondante                     |
| **Dopo il cutover** | **solo il tag**                                      | **l'unica cosa che regge** | **l'unica cosa che protegge il tag** |

Dopo `up -d` i vecchi container non esistono più: per Docker quelle immagini diventano `unused`, e un `image prune -a` le rimuove senza chiedere conferma. Registrare i due presidi come voci separate di una checklist lascia credere che siano alternative, o che il secondo sia una precauzione generica di igiene. Non lo è: è ciò che impedisce a un comando di pulizia ordinario di distruggere il rollback point mentre la finestra è ancora aperta.

## Prova empirica (S21, non simulata)

La finestra ha attraversato entrambi i regimi in circa 24 ore, e il presidio ha dimostrato la propria efficacia senza bisogno di un test costruito apposta:

- **Fase 1** (29/07, pre-build): tagged per image ID `7c237974dd40`, `a438196a94c1`, `df768cdbfb18`, `6a9be17efbd7`. In quel momento il tag era ridondante.
- **Fase 3** (30/07, build `--no-cache`): `:latest` è stato **riassegnato** alle quattro immagini nuove. Le quattro vecchie sono rimaste ancorate **dal solo tag**. Senza la Fase 1 sarebbero state dangling — cioè il rollback point sarebbe stato distrutto dal build stesso che lo rende necessario.
- **Fase 4** (cutover): la colonna "in uso" di `docker images` è caduta sulle quattro immagini di rollback. Segnale osservabile del passaggio di regime, e momento esatto in cui il divieto di prune inizia a essere l'unico presidio attivo.

Nota collaterale che rafforza la decisione: i "reclaimable" di `docker system df` includevano già, prima della finestra, le immagini di rollback di **finestre precedenti** (`rollback-pre-portata`, `rollback-pre-storno`, `rollback-pre-vat`). Un prune "di pulizia" eseguito in buona fede avrebbe spazzato via anche quelli.

## Conseguenze

**Positive**

- Il rollback point smette di dipendere dalla memoria dell'operatore e diventa verificabile: c'è un output atteso, e senza quello il build non parte.
- La verifica a prefisso della label OCI intercetta il tag applicato all'immagine sbagliata, che è il modo silenzioso in cui il presidio fallirebbe pur sembrando presente.
- Il rollback resta **per-servizio**: si può tornare indietro su un solo servizio senza toccare gli altri.

**Costi accettati**

- Le immagini di rollback accumulano spazio disco e **non sono raccoglibili** con i comandi ordinari finché la finestra è aperta. Se emerge pressione sullo spazio: STOP, e si nominano le immagini da liberare una per una, fuori finestra.
- Il divieto vale anche per la build cache, che dopo un `--no-cache` cresce in modo non trascurabile.

## Alternative scartate

- **Affidarsi ai soli digest annotati** (forma precedente del runbook): il digest annotato in un report non impedisce al garbage collector di rimuovere l'immagine. Documenta il rollback point, non lo preserva.
- **Registry esterno con push delle immagini in esercizio**: preserverebbe davvero, ma introduce un'infrastruttura che oggi non esiste e una dipendenza di rete in finestra di deploy. Riconsiderabile al primo cliente reale.
- **Prune selettivo consentito** (`prune` con filtri di età): un filtro di età non distingue l'immagine di rollback da un residuo, ed è esattamente il tipo di presidio che cede in silenzio quando cambia una condizione al contorno.

## Fuori scope

- Automazione del passo (script che tagga, verifica e blocca il build): il gate resta manuale, coerente con `TD-deploy-perm-reconcile-gate` che è nella stessa condizione.
- Politica di retention delle immagini di rollback delle finestre chiuse.
