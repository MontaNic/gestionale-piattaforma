# ADR-0024 — Fix TD-CA: catch `P2002` per-call-site (race TOCTOU unicità nome)

- **Status:** Accepted
- **Date:** 2026-05-22 (sessione 21, coda)
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0023](./ADR-0023-td-bz-partial-unique-soft-delete.md) (TD-BZ — partial unique index; il partial index **non** chiude la race TOCTOU, TD-CA ne è il complemento), [ADR-0012](./ADR-0012-frontend-auth-flow.md) (§TD-AY — `GlobalHttpExceptionFilter`)

## ✅ Status finale

**TD-CA RESOLVED.** Il pre-check di unicità nome (`findFirst`) e il successivo `create`/`update` non sono atomici: una race TOCTOU può far passare il pre-check e poi violare il partial unique index → `P2002`. `P2002` non è un `HttpException` → sfugge al `GlobalHttpExceptionFilter` (`@Catch(HttpException)`) → HTTP 500 invece di un 409 pulito.

Fix: helper `catchUniqueViolation(fn, errorCode)` che wrappa i `create`/`update` sul name-unique e converte `P2002` → `ConflictException({ errorCode })`. **Solo `apps/api`** (helper + 8 call-site), nessun cambio schema/migration/frontend, nessun nuovo errorCode.

## Context

**TD-CA** (catturato in ADR-0023): TD-BZ ha allineato la regola DB (partial unique index) al pre-check applicativo, ma il partial index **non** chiude la finestra TOCTOU tra `findFirst` e `create`/`update`. Sotto concorrenza, due richieste con lo stesso nome attivo passano entrambe il pre-check; la seconda viola il constraint → `P2002`.

Verifica empirica STOP 0:

- Il `GlobalHttpExceptionFilter` è **`@Catch(HttpException)`** — non intercetta i `PrismaClientKnownRequestError`. Un `P2002` raw → 500.
- Inventario unique constraint: **5 name-unique** (i partial index TD-BZ) vs **7 NON-name** (`ArticlePrice` join, `permissions.code`, `tenants.slug`, `users` email, `user_roles_*` join, `system_role_templates`). Un catch `P2002` **generico** mis-mapperebbe i 7 NON-name a "nome duplicato".
- **8 call-site** name-CRUD (4 service × {create, update}); i 4 `E_*_NAME_EXISTS` esistono già (lanciati dal pre-check) e sono già mappati nel frontend.

## Decision

**Catch `P2002` per-call-site via helper condiviso `catchUniqueViolation`**, NON nel filter.

Perché non nel filter: (a) `@Catch(HttpException)` non cattura affatto gli errori Prisma; (b) un filter globale non ha il contesto per scegliere il giusto `E_*_NAME_EXISTS` → mis-map sui 7 constraint NON-name.

**Garanzia di correttezza:** ciascuno dei 5 modelli name-unique ha **esattamente un** unique index (quello name). Quindi un `P2002` proveniente da uno specifico `tx.<model>.create/update` è **inequivocabilmente** il conflitto nome — l'helper non deve ispezionare `meta.target`, basta discriminare `e.code === 'P2002'` (ri-lancia P2025 e ogni altro code invariato).

L'helper produce `ConflictException({ errorCode })` — stessa shape che il `GlobalHttpExceptionFilter` normalizza per il pre-check esistente (`{ statusCode, errorCode, message }`); il `message` è il default 409 del filter (il `errorCode`, ciò che il frontend usa per l'i18n, è identico al pre-check).

Il pre-check `findFirst` resta **invariato** — gestisce il 99% dei casi con un messaggio descrittivo; l'helper è la rete per la sola race.

## GATE

- **Unit:** **95/95** (91 baseline + **4 nuovi** test di `catchUniqueViolation`: P2002 → `ConflictException`+errorCode; errore generico → ri-lanciato; P2025 → ri-lanciato non convertito; happy path).
- **E2E:** **56 pass / 4 skip** invariato — il pre-check normale non cambia → nessun nuovo comportamento E2E osservabile.
- **typecheck** workspace: clean.
- **No-over-claim:** la race TOCTOU **non** ha copertura E2E deterministica (non riproducibile in modo affidabile). È coperta dall'unit test dell'helper — la conversione `P2002 → 409`, non un test runtime della race reale.

## Files

| Path                                                         | Cosa cambia                                            |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `apps/api/src/common/prisma-errors.ts`                       | new — helper `catchUniqueViolation`                    |
| `apps/api/src/common/prisma-errors.spec.ts`                  | new — 4 unit test dell'helper                          |
| `apps/api/src/menus/menus.service.ts`                        | wrap `create`/`update` (`E_MENU_NAME_EXISTS`)          |
| `apps/api/src/menu-categories/menu-categories.service.ts`    | wrap `create`/`update` (`E_MENU_CATEGORY_NAME_EXISTS`) |
| `apps/api/src/articles/articles.service.ts`                  | wrap `create`/`update` (`E_ARTICLE_NAME_EXISTS`)       |
| `apps/api/src/price-lists/price-lists.service.ts`            | wrap `create`/`update` (`E_PRICE_LIST_NAME_EXISTS`)    |
| `docs/architecture/ADR-0024-td-ca-catch-unique-violation.md` | questo file                                            |

## Definition of Done

- [x] Helper `catchUniqueViolation` (verificato: import `Prisma` da `@gestionale/db`, shape `ConflictException` allineata al pre-check)
- [x] 8 call-site wrappati (4 service × create/update); soft-delete `update` esclusi (toccano solo `deletedAt`)
- [x] 4 unit test dell'helper (P2002 / errore generico / P2025 / happy path)
- [x] GATE: unit 95/95, E2E 56/4 invariato, typecheck clean
- [x] ADR-0024 + PROGRESS aggiornati; TD-CA → RESOLVED
- [ ] HEAD main avanzato via squash merge PR (owner da UI)
