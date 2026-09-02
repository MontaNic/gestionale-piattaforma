# ADR-0089 — Riconciliazione del DB al catalogo post-rimozione: mirata su prod, reset su dev

- **Stato**: Accettato
- **Data**: 2026-09-01
- **Contesto PR**: PR5 della sequenza di rimozione del verticale restaurant (PR1 → … → PR6)
- **Cross-ref**: [ADR-0060](ADR-0060-sync-permessi-template-tenant-noop.md) (gate di deriva) · [ADR-0080](ADR-0080-seed-fail-closed-node-env.md) (seed fail-closed) · [ADR-0086](ADR-0086-rollback-point-coppia-bloccante.md) (rollback point) · runbook di deploy §Passo 2

---

## Contesto

PR4 ha ridotto il catalogo RBAC nel codice a **44 permessi / 7 template / 154 mapping**, lasciando di proposito DB dev e prod a **64 / 11 / 267**. Il gate `check-role-permissions-drift` era quindi rosso su entrambi — un rosso che **nessuna PR di codice poteva chiudere**, perché il disallineamento era nei dati.

PR5 è la **prima operazione irreversibile della sequenza**: un `git revert` non annulla un `DELETE`.

## Decisione

**Due strategie diverse per i due ambienti, e la differenza non è pigrizia: è il valore di ciò che contengono.**

|           | dev                                                  | prod                                                      |
| --------- | ---------------------------------------------------- | --------------------------------------------------------- |
| strategia | **reset completo** (volume distrutto, migrate, seed) | **riconciliazione mirata** in transazione                 |
| perché    | il seed rigenera tutto ciò che c'è                   | `studio-demo` ha lavoro reale che nessuno script rigenera |

Su prod il perimetro è **stretto per scelta**: quattro tabelle — `role_permissions` → `system_role_template_permissions` → `system_role_templates` → `permissions` — nell'ordine imposto dalle FK. **I due tenant food (`demo`, `acme`) NON vengono cancellati qui**: vanno con PR6, insieme alle tabelle di dominio che li contengono. Finché esistono, i dati food restano leggibili se PR6 scoprisse che qualcosa serviva.

## Come è stata eseguita

### 1. Il dump precede ogni scrittura

```
/home/deploy/backups/gestionale_20260902T204540Z_pre-pr5-riconcilia_53556fd.dump
magic PGDMP · 289.484 B · chmod 600 · sha256 in .sha256 · pg_dump exit 0, stderr vuoto
```

**Il magic-byte non è una verifica di integrità**: sono cinque byte in testa al file. La verifica vera è stata `pg_restore --list` → **exit 0, 525 voci di TOC, 49 `TABLE DATA`**, con le quattro tabelle bersaglio e tutte quelle del lavoro di `studio-demo` presenti.

⚠️ **Il dump NON copre `storage_data`** (`TD-storage-backup-blob`): `pg_dump` copia righe, non blob. Gli allegati vivono nel volume `gestionale_storage_data`. Per questa operazione lo scarto non è in gioco — nessuna riga toccata referenzia un blob — ma la frase va letta ogni volta che si rilegge questo ADR.

Nota operativa: `pg_restore --list` su formato custom richiede un file **seekable**. Passandogli una pipe risponde `did not find magic string in file header`, che sembra parlare del dump e invece parla del canale.

### 2. Dev prima di prod, e non per cautela generica

Il reset di dev è la **prova che il codice post-PR4 produce uno stato coerente partendo da zero**. Se il seed non fosse arrivato a 44/7/154 su un DB vuoto, il problema sarebbe stato nel catalogo, non nei dati di prod.

⚠️ **`pnpm devdb:down` non resetta niente**: è `docker compose down` **senza `-v`**, quindi preserva il volume. Con il volume superstite il seed avrebbe aggiunto i 44 permessi _sopra_ i 64 esistenti senza rimuoverne nessuno (è `TD-seed-non-ripulisce-rimossi`) e il gate sarebbe rimasto rosso. Il reset è `down -v`.

⚠️ **`prisma:migrate:dev` di `packages/db` punta a PRODUZIONE** (`dotenv -e ../../.env`, che è il file di prod). Lo script per il DB dev è **`devdb:migrate`**, che carica `.env.devdb` per primo e usa `migrate deploy`. Il nome inganna: `:dev` qualifica il comando Prisma, non l'ambiente.

### 3. La transazione è autoverificante

Un solo `psql`, un solo `BEGIN`. Ogni `DELETE` conta le righe; **due asserzioni** fanno abortire tutto se il numero non torna:

- sul **delta**: 20 permessi, 4 template, 80 `role_permissions` — altrimenti `RAISE EXCEPTION`;
- sullo **stato finale**, dentro la stessa transazione e prima del `COMMIT`: 44 / 7 / 154.

La seconda è quella che conta di più: verifica il risultato, non l'operazione. Un delta giusto su uno stato di partenza sbagliato produce comunque uno stato finale sbagliato, e solo l'asserzione sul risultato lo intercetta.

Le liste dei 44 codici e dei 7 nomi sono state **generate dal catalogo in `rbac-catalog.ts`**, non scritte a mano: una lista battuta a mano è il modo in cui si cancella un permesso di troppo.

### Esito

```
NOTICE: cancellate: role_permissions=80, srtp(via permesso)=98, srtp(via template)=15, templates=4, permissions=20
NOTICE: stato finale in transazione: permessi=44, template=7, srtp=154
COMMIT
```

|                                    | prima | dopo    |
| ---------------------------------- | ----- | ------- |
| `permissions`                      | 64    | **44**  |
| `system_role_templates`            | 11    | **7**   |
| `system_role_template_permissions` | 267   | **154** |
| `role_permissions`                 | 262   | **182** |

Su dev, dopo il reset: 44 / 7 / 154, `role_permissions` 102, ed entrambi i ruoli `Direzione` spariti — quello di `demo` perché il seed non lo crea più, l'orfano soft-deleted di `studio-demo` perché il volume è stato distrutto.

## Verifica

**Il criterio di «fatto» non è «la query è andata», è il gate verde su entrambi**, col target stampato:

```
✅ GATE VERDE — 127.0.0.1:5432/gestionale:  6 ruoli materializzati su 6 totali
✅ GATE VERDE — 127.0.0.1:55432/gestionale: 4 ruoli materializzati su 4 totali
```

`6 su 6` e `4 su 4`: **zero ruoli esaminati sarebbe rosso, non verde.**

### L'applicazione regge, verificato e non dedotto

I container di produzione girano su `cf0e521`, che conosce i **64** permessi vecchi: dopo questa operazione **il codice in produzione è più vecchio del DB**. Verificato a runtime:

|                                                                                   |                            |
| --------------------------------------------------------------------------------- | -------------------------- |
| `/api/v1/health` · apex · pagina di login                                         | 200 · 307 · 200            |
| `POST /api/v1/auth/login` (`X-Tenant-Slug: studio-demo`)                          | **201**, token emesso      |
| `GET /me` · `dashboard/stats` · `aziende` · `mandati` · `scadenze` · `note-spese` | **200** su tutti           |
| permessi effettivi visti dall'app per `admin@studio.local`                        | **40**, di cui food: **0** |

Il numero 40 è la prova che chiude il cerchio: è `ALL_PERMISSION_CODES` del catalogo nuovo (44 meno i 4 `portale.*`), letto dall'app in produzione attraverso il DB riconciliato.

Nessun container riavviato (`Up 4 weeks`), nessun `prune`: le 4 immagini `rollback-pre-design-*` e le 2 `rollback-pre-pr2-cf0e521` sono intatte.

## Conseguenze

**Positive**

- Il gate permessi è verde su entrambi gli ambienti per la prima volta dalla PR4, e la finestra aperta da quel merge è chiusa.
- Il perimetro stretto ha tenuto la transazione leggibile: 4 tabelle, 5 `DELETE`, 2 asserzioni.

**Costi accettati**

- **Irreversibile.** Il rollback è il ripristino del dump, che riporta indietro l'intero DB — non solo le righe di questa operazione.
- **`demo` e `acme` restano in prod** con i loro dati food (11 tavoli, 10 articoli, 2 menu). È deliberato, non un residuo: PR6 li rimuove insieme alle tabelle.
- Il DB è ora **più nuovo del codice deployato**. Non è un problema per i 20 permessi rimossi — tutti food, nessun consumer accountant — ma è uno stato che va chiuso al prossimo deploy.

## Fuori scope

- I 2 tenant food e le tabelle di dominio (PR6).
- Schema Prisma e migrazione distruttiva (PR6).
- Deploy e `caddy reload`.
