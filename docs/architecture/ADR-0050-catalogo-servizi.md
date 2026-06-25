# ADR-0050 — Catalogo servizi: listino studio + collegamento preventivi

Status: Accepted
Date: 2026-06-25
Verticale: accountant (livello 1, operatore-studio) — Onda 3 Task 1

## Context

I preventivi (ADR-0037) nascono MVP con voci **completamente denormalizzate** e
nessun catalogo: ogni voce viene digitata a mano (`PreventivoVoce` con
nome/prezzo/iva/um inline, "no FK a catalogo in MVP"). Lo studio ripete gli
stessi servizi su ogni preventivo senza un listino riusabile.

Questo task introduce un **catalogo servizi** (categorie + voci) riusabile nei
preventivi, con un set standard di piattaforma (servizi tipici di uno studio
commercialista) estendibile per-tenant.

## Decision

### 1. DP-modelli — `ServizioCategoria` + `ServizioCatalogo`, pattern platform/custom

Due nuovi modelli sul pattern **`ScadenzaCategoria`/`DocumentoTipo`**:

- `tenantId String?` **nullable**: `null` = riga di **piattaforma** (catalogo
  standard condiviso, seedato una volta), valorizzato = voce **custom** dello
  studio.
- enum `UnitaMisura` **riusato** (combacia col legacy: forfait/ora/mese/anno/
  documento/dipendente/pezzo); nuovo enum `TipoRicorrenza` (una_tantum/mensile/
  annuale).
- `ServizioCatalogo.categoriaId` → FK `ON DELETE SET NULL`.
- `prezzoBase`/`ivaAliquota` come `Decimal` (10,2 / 5,2).

### 2. DP-no-RLS — scoping applicativo esplicito

I due modelli **NON hanno RLS**: le righe di piattaforma (`tenant_id NULL`)
sarebbero incompatibili con una policy `tenant_isolation` (che richiede
`tenant_id = current_setting('app.tenant_id')`). Come `ScadenzaCategoria`, lo
scoping è **esplicito nel service**: `where: { OR: [{ tenantId: null }, { tenantId }] }`.

Unicità via **partial unique index** raw SQL (Prisma 6 non li esprime):
`(tenant_id, nome)` e `(tenant_id, codice)` `WHERE tenant_id IS NOT NULL` → le
righe custom sono uniche per-tenant, le platform non vincolate fra loro.

### 3. DP-invariante accesso — platform read-only

Le righe di piattaforma sono **visibili a tutti** i tenant ma
**modificabili/cancellabili da nessuno** (solo seed/superadmin). In scrittura il
service applica `assert*Owned()`: la riga deve essere in-scope (404 altrimenti) e
NON di piattaforma (`tenantId === null` → **403** `E_SERVIZIO_*_PLATFORM_READONLY`).
Le righe custom hanno sempre `tenantId == chiamante` (garantito dallo scoping).

DELETE **fisico** (no soft-delete su lookup table). La FK
`preventivi_voci.servizio_id` è `ON DELETE SET NULL`.

### 4. DP-collegamento preventivi — `servizioId` snapshot-safe

`PreventivoVoce.servizioId String?` (FK `SetNull`): traccia da quale voce di
catalogo è stata pre-compilata la riga. **Non vincola il prezzo**: lo snapshot
denormalizzato della voce (nome/prezzo/iva/um) resta sorgente di verità, così:

- modificare/eliminare un servizio di catalogo **non muta** i preventivi storici;
- la UX "Dal catalogo" pre-compila una voce (prezzo/iva/um copiati) che resta
  pienamente editabile.

### 5. DP-permessi — `servizi.{visualizza,gestisci}`

Due nuovi permessi (catalogo permessi: 50 → 52). Assegnati a Super Admin / Admin
sede / Socio (via `ALL_PERMISSION_CODES`) e `servizi.visualizza` al Collaboratore.

## Consequences

- Catalogo standard di piattaforma (6 categorie, 20 voci) disponibile out-of-box
  a ogni tenant; ogni studio aggiunge le proprie voci.
- I preventivi guadagnano il pulsante "Dal catalogo" senza perdere la libertà di
  editing manuale né la stabilità dei totali storici.
- Nuova superficie CRUD (`/catalogo/categorie`, `/catalogo/servizi`) gated RBAC.

## Alternatives considered

- **RLS sui due modelli** → scartato: le righe platform `tenant_id NULL` sono
  incompatibili con la policy tenant; lo scoping applicativo (pattern già in uso
  per scadenze/documenti) è coerente e testato.
- **Lock del prezzo sulla voce dal catalogo** (FK + prezzo derivato) → scartato:
  romperebbe i preventivi storici al variare del listino. Lo snapshot
  denormalizzato + `servizioId` solo-tracciabilità è più robusto.

## Note di esecuzione (sub-DP emersi)

- Conteggio permessi reale **50 → 52** (non 55→57: il "55" della spec derivava da
  un `grep -c "code:"` che includeva match non-array).
- Route FE: nessun segmento `studio/` nel routing reale → pagina in
  `app/t/[slug]/(authenticated)/catalogo/`.
- Sidebar: nessun gating per-permesso sulle voci (pattern esistente) → la voce
  "Catalogo servizi" è visibile, la pagina applica il gating `servizi.visualizza`.
- `@nestjs/mapped-types` non è dipendenza del repo → update DTO manuali
  all-optional (convenzione esistente), non `PartialType`.
- `truncateDatabase` (e2e helper) esteso con `servizi_catalogo`/`servizi_categorie`:
  le righe platform `tenant_id NULL` non hanno FK a `tenants`, quindi il
  `TRUNCATE ... CASCADE` non le rimuoveva (accumulo tra test).
