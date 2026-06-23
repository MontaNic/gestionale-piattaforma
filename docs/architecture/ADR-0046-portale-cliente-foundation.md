# ADR-0046 — Portale cliente (livello 2): fondamenta identità + login + route-group

Status: Accepted
Date: 2026-06-23
Verticale: accountant (livello 2, utente-cliente)

## Context

I moduli accountant di livello 1 (operatore-studio) hanno lasciato **superfici
dormienti** esplicitamente differite "al livello 2 / portale cliente":

- [ADR-0043](ADR-0043-comunicazioni-module.md): `ComLato.cliente` nell'enum, ma
  l'operatore non può scrivere `lato='cliente'` ("riservato al portale").
- [ADR-0044](ADR-0044-documenti-module.md): `VisibilitaDocumento.azienda` +
  enum `utente` forward; nessun lettore cliente.
- [ADR-0045](ADR-0045-circolari-mvp.md): `DestinatarioTipo.utente`,
  permesso `circolari.read_report`, `circolari_letture`/`richiede_conferma`
  tutti DEFER al livello 2 (TD-circolari-letture).

Manca però il **prerequisito comune** di tutte queste superfici: un'**identità
utente-cliente** che possa autenticarsi al portale ed essere scoperta sulla
propria azienda. Oggi il modello `User` non distingue operatore da cliente e non
ha alcun legame con `aziende`: ogni `User` è implicitamente un operatore di studio.

Questo ADR fissa le **fondamenta** del portale (Task 1 del livello 2): modello
identità, flusso di login, superficie web. NON attiva ancora alcun endpoint dati
cliente (è il task successivo, Documenti read-only).

**Autorità di design.** Il `PROJECT_BRIEF.md` è il brief della _ristorazione_
(cliente finale = avventore: prenotazione tavolo, asporto, fidelity) e **non**
descrive il portale-cliente di uno studio. L'autorità per questo verticale è la
sorgente legacy `docs/studiodesk/STUDIO_DESK.md` + i deferral di ADR-0043/44/45.

## Decision

### 1. DP-identità — single-table su `User` (no tabella separata)

Operatori e clienti vivono nella **stessa** tabella `users`, discriminati da un
campo `tipo`, coerente col modello legacy (`users.ruolo ENUM(...,'cliente')` +
`azienda_id` + `cliente_ruolo`):

- `enum UserTipo { operatore, cliente }`, `User.tipo @default(operatore)`. Gli
  User esistenti restano `operatore` per default → **backfill implicito**, zero
  migrazione dati.
- `User.aziendaId String?` → relation `User → Azienda` (CASCADE: l'eliminazione
  di un'azienda elimina i suoi utenti-portale; divergenza consapevole dal legacy
  `SET NULL`, che sarebbe incompatibile con l'invariante §2).
- `enum ClienteRuolo { admin, utente }`, `User.clienteRuolo?` — ruolo _interno_
  all'azienda cliente (admin azienda = gestisce anagrafica/referenti/inviti della
  propria azienda; arriva coi task successivi). Nullo per gli operatori.

**Perché single-table e non `ClienteUser` separata:** riusa senza duplicare
l'intero stack auth (sessioni, lockout, refresh-rotation con theft-detection,
RLS tenant). Una tabella separata richiederebbe di duplicare o astrarre quello
stack per un guadagno di isolamento che il discriminatore `tipo` + i permessi già
forniscono.

### 2. DP-invariante — CHECK constraint DB `tipo ⟺ azienda_id`

L'integrità "un cliente ha sempre un'azienda, un operatore non ne ha mai" è
garantita a **livello DB** (non solo app-side), appesa a mano nella migration
come per le policy RLS:

```sql
ALTER TABLE users ADD CONSTRAINT chk_cliente_azienda_id
  CHECK (
    (tipo = 'operatore' AND azienda_id IS NULL) OR
    (tipo = 'cliente'   AND azienda_id IS NOT NULL)
  );
```

Defense-in-depth: nessun path applicativo può creare un cliente orfano di azienda
o un operatore agganciato a un'azienda.

### 3. DP-scoping — azienda è app-level, non RLS

L'RLS resta **tenant-level** (invariata): un cliente vede solo le righe del
proprio tenant via le policy esistenti. Lo scoping ulteriore "solo la _mia_
azienda" è **applicativo** (filtro `aziendaId` nei service), identico a come
documenti/comunicazioni già filtrano per azienda lato studio. Non si introduce
RLS per-azienda (complessità non giustificata: il principal porta `aziendaId`).

### 4. DP-login — endpoint unico, gating per `tipo`

Il cliente autentica con lo **stesso** `POST /auth/login` (email+password):
nessun nuovo endpoint, nessun cambio allo shape del JWT (resta minimal
`sub/tenantId/sessionId/type`). Coerente col legacy (`login.php` serve "cliente +
operatori", `richiediLogin('operatore'|'cliente')`).

- `AuthenticatedUser` + `JwtStrategy` + `FullProfile` (`/me`) espongono `tipo`,
  `aziendaId`, `clienteRuolo` (caricati fresh dal DB, come ruoli/permessi).
- Il **redirect post-login** è per `tipo`: operatore → `(authenticated)`
  dashboard, cliente → `(portale)`. La separazione delle superfici è retta dai
  **permessi** (la `PermissionsGuard` esistente): un cliente non ha permessi
  studio e viceversa.

### 5. DP-web — sotto-albero `/portale` in accountant-web (no app/subdomain)

Il portale è un **sotto-albero di route** `/t/[slug]/portale/...` nella stessa
`accountant-web`, con `layout.tsx` + shell propri (separati dalla `MainLayout`
studio), NON un'app separata né un subdomain `<slug>.studiodesk.cloud`:
quest'ultimo richiederebbe prima la containerizzazione di api/web +
`reverse_proxy` in Caddy ([ADR-0042](ADR-0042-domains-resolver-colocated-hosts.md)),
oggi non fatto. Stessa app = zero lavoro infra, time-to-livello-2 minimo. Le due
superfici sono separate da un role-gate (`RequireTipo`): un cliente nel
back-office viene rimandato al portale e viceversa.

### 6. DP-permessi — namespace `portale.*` separato

I permessi cliente vivono nel namespace `portale.*` (Task 1 seeda
`portale.documenti.visualizza`, consumer reale nel task Documenti). Sono
**esclusi** dai template studio (`Super Admin`/`Admin sede`/`Socio` che ricevono
"tutti i permessi"): un permesso cliente-facing su un operatore sarebbe privo di
senso. Nuovo role template **"Cliente"** che li raccoglie.

### 7. DP-defer — onboarding via invito differito

Nel legacy un cliente nasce **solo** via invito (token 32char, 7gg →
`registrati.php`, auto-promote del primo utente azienda a `cliente_ruolo='admin'`
anti-orfano). Invito + reset-password + PIN-cliente sono **fuori scope Task 1**:
mancano sia il framework email multi-tenant (vedi ADR-0045 §6) sia il consumer.
Per la verifica runtime, il Task 1 **seeda un cliente demo** con password nota
legato a un'azienda demo.

## Consequences

### Positive

- Riuso totale dello stack auth (sessione/lockout/refresh/RLS) per i clienti.
- Backfill implicito (default `operatore`) → migration non distruttiva, zero
  data-migration sugli User esistenti.
- Invariante identità garantita dal DB (CHECK), non solo dal codice.
- Schema forward per le superfici dormienti: i task Documenti/Comunicazioni/
  Circolari lato-cliente non richiedono altre migration sull'identità.

### Negative / Trade-off

- `tipo`/`aziendaId`/`clienteRuolo` su una tabella `users` che diventa "mista":
  ogni query studio-side deve restare implicitamente filtrata (i permessi lo
  garantiscono, ma è un invariante da non perdere di vista).
- Route-group condiviso: portale e back-office studio condividono build/deploy.
  Se in futuro servisse isolamento forte (subdomain), sarà un refactor (accettato:
  YAGNI finché api/web non sono containerizzate).

### Neutral

- Login unico: una sola pagina `/t/[slug]/login`, niente "trova il tuo portale"
  del legacy (lo slug è già nell'URL path-based).

## Out of scope — backlog (NON implementati)

Endpoint dati documenti lato cliente (task successivo) · invito/`registrati` ·
reset-password · PIN cliente · subdomain/Caddy reverse_proxy · gestione
anagrafica self-service (cliente_ruolo='admin') · reparti azienda.

## Tech debt

- **TD-portale-invito**: flusso invito (token + accept + auto-promote admin) +
  framework email multi-tenant.
- **TD-portale-subdomain**: valutazione `<slug>.studiodesk.cloud` quando api/web
  saranno containerizzate dietro Caddy (ADR-0042).
- **TD-portale-azienda-rls**: se il filtro app-level per-azienda si rivelasse
  insufficiente, valutare RLS per-azienda (oggi YAGNI).

## Notes

Migration `add_portale_cliente_identity` (DDL Prisma + CHECK appeso a mano, come
le policy RLS di `add_comunicazioni`/`add_documenti`/`add_circolari`). Seed:
nuovo permesso `portale.documenti.visualizza` + role template "Cliente" + cliente
demo (`cliente@studio-demo.local`) su azienda demo del tenant `studio-demo`.
