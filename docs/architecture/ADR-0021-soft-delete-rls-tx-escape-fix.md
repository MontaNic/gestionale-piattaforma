# ADR-0021 — Fix soft-delete: escape della transazione RLS nell'extension `softDelete`

- **Status:** Accepted
- **Date:** 2026-05-22 (sessione 19)
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0005](./ADR-0005-prisma-data-layer.md) (data layer — soft-delete extension), [ADR-0009](./ADR-0009-rls-real.md) (RLS reali — `withTenantContextAtomicTx`, ruolo `gestionale_app`), [ADR-0019](./ADR-0019-f1-menu-crud-schema.md) (F1 Menu CRUD — i service `softDelete` affetti), [ADR-0020](./ADR-0020-f1-menu-ui-crud.md) (F1 Menu UI — la verifica runtime S19 ha esposto il bug)

## ✅ Status finale

Bug del data-layer risolto: il soft-delete eseguito via `tx.<model>.delete()` dentro `withTenantContextAtomicTx` falliva con **HTTP 500 (Prisma P2025)** in dev/prod (ruolo runtime `gestionale_app`, non-superuser, RLS `FORCE`). Colpiva **ogni** modello con `deletedAt` — in pratica i 4 endpoint DELETE di F1 Menu (Menu, MenuCategory, Article, PriceList).

- **Fix:** i 4 service `softDelete` usano `tx.<model>.update({ data: { deletedAt: new Date() } })` esplicito invece di `tx.<model>.delete()`.
- **Test di regressione E2E non-superuser** (`soft-delete-rls.e2e-spec.ts`) — primo spec del progetto che boota l'app come `gestionale_app`: fallisce sul codice pre-fix (500), passa post-fix (200).
- **Convention** documentata (§convention) + interceptor `delete`/`deleteMany` di `soft-delete.ts` annotati come trap.
- Bug pre-esistente dal soft-delete framework (ADR-0005), **non** introdotto da S19. S19 (frontend) è stato il primo codice a esercitare gli endpoint DELETE a runtime.

## Context

La verifica runtime di S19 (ADR-0020) ha rilevato che `DELETE /menus/:id`, `/menus/:menuId/categories/:id`, `/articles/:id` → **HTTP 500**. Riproduzione isolata via `curl` (no frontend): 3/3 DELETE → 500 con `PrismaClientKnownRequestError P2025` a `soft-delete.ts:141`.

Perché latente fino a S19: ogni service F1 fa `tx.<model>.delete()` dentro `withTenantContextAtomicTx`, ma S19 è il primo codice che esercita davvero questi endpoint DELETE a runtime contro la connessione reale `gestionale_app`. La suite E2E S17 (`menus-crud` test 5, `articles-crud`, `menu-categories-crud` test 5) "passava" perché i Testcontainers connettono come `postgres` **superuser**, che bypassa la RLS (anche con `FORCE`).

## Decisions

### DP-1 — Root cause: il rewrite `delete`→`update` esce dalla transazione

`softDeleteExtension` ([soft-delete.ts](../../packages/db/src/soft-delete.ts)) intercetta `delete` e lo riscrive:

```ts
const delegate = (client as any)[lowerFirst(model)];
return delegate.update({ where: args.where, data: { deletedAt: new Date() } });
```

`client` è il parametro catturato in `Prisma.defineExtension((client) => …)` — il client **non-transazionale**, fissato alla definizione dell'extension. Quando `tx.<model>.delete()` è invocato dentro `withTenantContextAtomicTx`:

1. L'interceptor `delete` chiama `client.<model>.update(...)` sul client base, **non sul `tx`**.
2. La guard `inflightStorage` di `rlsExtension` (attiva dentro l'atomic tx) fa sì che quell'`update` esegua **senza** aprire il proprio `$transaction` con `SET LOCAL app.tenant_id`.
3. L'`UPDATE` gira quindi su una connessione pooled priva del GUC `app.tenant_id`.
4. La RLS policy `USING (current_setting('app.is_super_admin', true) = 'true' OR tenant_id = current_setting('app.tenant_id', true))` valuta NULL → 0 righe visibili → `update` colpisce 0 righe → **P2025** → 500.

Il `findFirst` precedente (in-tx, RLS context attivo) trova il record; solo l'`update` escapato fallisce. Confermato empiricamente: app come `gestionale_app` → 500; E2E come `postgres` superuser → RLS bypassata → 200.

### DP-2 — Fix service-level (non extension-level)

I 4 service `softDelete` cambiano `tx.<model>.delete({ where })` → `tx.<model>.update({ where, data: { deletedAt: new Date() } })`.

- ✅ `tx.<model>.update()` gira **sul `tx`** → `SET LOCAL app.tenant_id` attivo → RLS passa. È lo stesso identico pattern già usato e funzionante in `.update()` dei service (verificato: gli edit in S19 passavano).
- ✅ `update` non è intercettato da `softDeleteExtension` → nessun rewrite, nessun escape.
- ✅ minimo, basso rischio, zero dipendenza dagli internals delle extension Prisma.
- ❌ **Non** un fix extension-level: l'interceptor `delete` non riceve un handle al client transazionale; renderlo tx-safe è un refactor architetturale (spostare il rewrite dentro `rlsExtension.$allOperations` dove il `tx` è disponibile, oppure convertirlo a model-extension `softDelete()` con `Prisma.getExtensionContext`). Fuori scope per un bugfix → **TD-BW**.

L'interceptor `delete`/`deleteMany` di `soft-delete.ts` **resta** (corretto per `delete()` non-transazionali, es. system context) ma è ora annotato come trap.

### DP-3 — Test di regressione obbligatorio come ruolo non-superuser

Nuovo spec `apps/api/test/e2e/soft-delete-rls.e2e-spec.ts` — l'**unico** che boota l'app come `gestionale_app` (NOSUPERUSER NOBYPASSRLS). Riusa l'infrastruttura E2E esistente senza modificarla: passa a `createTestApp` un `databaseUrl` derivato col ruolo `gestionale_app` (creato dalla migration `20260513002159`, presente quindi anche nei Testcontainers). 3 test: DELETE Menu/Categoria/Articolo → 200. Verificato: **fallisce 3/3 (500) sul codice pre-fix**, passa 3/3 post-fix.

La conversione dell'intera suite E2E a non-superuser è **fuori scope** (→ TD-BV): la suite resta superuser, si aggiunge solo questo spec mirato.

## §convention — Soft-delete dentro un atomic tx tenant-scoped

> **Regola:** per il soft-delete di un record dentro `withTenantContextAtomicTx` / `withSystemContextAtomicTx`, usare **sempre** l'update esplicito del campo `deletedAt`:
>
> ```ts
> await tx.<model>.update({ where: { id }, data: { deletedAt: new Date() } });
> // ❌ MAI: await tx.<model>.delete({ where: { id } });
> ```
>
> Motivo: l'interceptor `delete` di `softDeleteExtension` riscrive `delete`→`update` su un client non-transazionale, che esce dal context RLS della transazione (vedi DP-1). `tx.<model>.delete()` dentro un atomic tx con RLS forzata → P2025.
>
> `tx.<model>.delete()` resta valido **solo** fuori da un atomic tx (chiamate dirette, system context non-RLS). La rimozione definitiva di questa asimmetria (rendere l'interceptor tx-safe) è tracciata da **TD-BW**.

La convention è anche annotata inline negli interceptor `delete`/`deleteMany` di `soft-delete.ts` e nel commento di ogni `softDelete` service.

## Tech debt

### TD-BV — La suite E2E gira come `postgres` superuser → blind spot RLS

I Testcontainers connettono come `postgres` superuser ([test-containers.ts:39](../../apps/api/test/e2e/helpers/test-containers.ts#L39)), che bypassa la RLS anche con `FORCE`. Conseguenza: **l'intera suite E2E non può intercettare alcun bug di interazione con la RLS** — questo soft-delete ne è la prova (i test DELETE S17 passavano nonostante il bug). Migration path: valutare la conversione della suite (o di un subset significativo) al ruolo `gestionale_app`, accettando che possa far emergere altri bug RLS latenti (effetto desiderato). Decisione non banale (impatto su tutti gli spec) → task dedicato. Mitigazione interim: lo spec `soft-delete-rls.e2e-spec.ts` copre il path soft-delete.

### TD-BW — Refactor tx-safe dell'interceptor soft-delete

L'interceptor `delete`/`deleteMany` di `softDeleteExtension` non è RLS-safe dentro una transazione (DP-1). Il fix DP-2 aggira il problema a livello service (convention §convention), ma l'interceptor resta una trap per codice futuro. Refactor candidato: spostare il rewrite `delete`→`update` dentro `rlsExtension.$allOperations` (dove il `tx` è disponibile via il `$transaction` interno), oppure convertire a model-extension `softDelete()` con `Prisma.getExtensionContext(this)`. Una volta risolto, `tx.<model>.delete()` tornerebbe sicuro e la §convention sarebbe superflua.

## Files

| Path                                                          | Cosa cambia                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api/src/menus/menus.service.ts`                         | `softDelete`: `tx.menu.delete()` → `tx.menu.update({ deletedAt })`             |
| `apps/api/src/menu-categories/menu-categories.service.ts`     | `softDelete`: `tx.menuCategory.delete()` → `update({ deletedAt })`             |
| `apps/api/src/articles/articles.service.ts`                   | `softDelete`: `tx.article.delete()` → `update({ deletedAt })`                  |
| `apps/api/src/price-lists/price-lists.service.ts`             | `softDelete`: `tx.priceList.delete()` → `update({ deletedAt })`                |
| `packages/db/src/soft-delete.ts`                              | annotazione trap su interceptor `delete` + `deleteMany` (no change funzionale) |
| `apps/api/test/e2e/soft-delete-rls.e2e-spec.ts`               | **nuovo** — regressione soft-delete come ruolo non-superuser (3 test)          |
| `docs/architecture/ADR-0021-soft-delete-rls-tx-escape-fix.md` | questo file                                                                    |
| `PROGRESS.md`                                                 | entry sessione 19 (fix)                                                        |

## Definition of Done

- [x] Root cause confermata (curl + log P2025 + analisi `client` non-tx + ruolo `gestionale_app` non-superuser)
- [x] Fix service-level applicato ai 4 `softDelete` (Menu / MenuCategory / Article / PriceList)
- [x] `soft-delete.ts` annotato (trap `delete` + `deleteMany`)
- [x] Test di regressione non-superuser: rosso pre-fix (500 ×3), verde post-fix (200 ×3)
- [x] GATE: unit 91/91, typecheck clean, lint clean, full E2E suite invariata + 3 nuovi test
- [x] §convention documentata in ADR + inline nel codice
- [x] TD-BV + TD-BW catturati
- [ ] Ri-verifica end-to-end del delete F1 Menu UI come ruolo non-superuser (post-merge fix → rebase S19)
