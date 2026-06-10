# ADR-0038 — Dashboard operatore-studio (endpoint /dashboard/stats + card-grid)

- **Status:** Accepted
- **Date:** 2026-06-10
- **Relates:** ADR-0037 (preventivi UI / gotcha Decimal wire), ADR-0036 (preventivi backend), ADR-0009 (RLS tenant context), ADR-0021 (soft-delete), ADR-0035 (RLS isolation e2e)
- **Slice:** FULL — prima query aggregata (count/groupBy/aggregate) del progetto, primo endpoint stats

## Contesto

Prima dashboard del verticale commercialisti. Livello "operatore-studio" (chi gestisce
i clienti dello studio), NON portale-cliente né super-admin-piattaforma (entrambi roadmap
futura — vedi §roadmap). Riferimento UX: StudioDesk PHP (card-grid servizi + widget
attività recente), preso come base, non copiato. Domini disponibili in TS oggi:
aziende (clienti) + preventivi — gli unici su cui una dashboard può dire la verità.

## Decisioni

**DP-scope = operatore-studio, scaglione 2 (endpoint aggregazione), forma C (card-grid).**
Card reali SOLO Clienti + Preventivi — niente card-placeholder per moduli non costruiti
(Comunicazioni/Documenti/Scadenze… YAGNI/Pattern 43). Le card crescono slice dopo slice.

**DP-permessi = riuso per-dominio.** Endpoint richiede `anagrafica.cliente.visualizza`
(ancora la dashboard ai clienti). NESSUN permesso `dashboard.*` nuovo: la dashboard
mostra dati di domini già permission-gated, inventare un permesso sarebbe RBAC senza
ragione. Alternativa scartata: `report.*` (semantica diversa nel vecchio StudioDesk).

**DP-stats-shape = KPI + lista ultimi 5 preventivi.** L'endpoint ritorna conteggi
aggregati + i 5 preventivi più recenti (orderBy updatedAt desc). La lista dà alla
dashboard senso oltre ai contatori (come "ultime comunicazioni" StudioDesk).

**Card Clienti = Opzione 2 (due tagli ortogonali).** Numero grande = totale clienti
(non-deleted); riga 1 taglio stato (attivi · non attivi); riga 2 taglio tipo
(aziende · persone fisiche). Le due righe sono dimensioni indipendenti dello stesso
insieme, non l'una scomposizione dell'altra. `nonAttivi` come count esplicito (non
derivato totale-attivi) → invariante e2e `attivi+nonAttivi==totale` genuino.
Alternativa scartata: Opzione 1 (breakdown solo attive) — più snella ma perde
visibilità sugli inattivi.

**Aggregate sotto RLS — nessun wrap esplicito (verificato).** count/groupBy/aggregate
sono model-op → passano per `$allOperations` (rls.ts) → girano sotto il tenant context
dell'interceptor con SET LOCAL app.tenant_id, RLS-filtered come le CRUD. softDelete
extension inietta `deletedAt=null` anche su count/aggregate/groupBy (withSoftDeleteFilter)
→ i KPI non contano i soft-deleted. Verificato a runtime sotto gestionale_app
non-superuser: il PREV-TEST-UI soft-deleted è correttamente escluso (totale 2, non 3).

**where:{tenantId} esplicito** mantenuto nelle query (difesa in-depth oltre RLS),
coerente col pattern dei service esistenti (aziende.service:29, preventivi.service:81).

**Decimal→Number nel service** (toNumber()) → il FE riceve number puliti (evita la
gotcha Prisma Decimal→stringa di ADR-0037).

## Roadmap (visione, NON scope di questo STOP)

Il verticale commercialisti punta a replicare l'impianto StudioDesk a tre livelli:

1. **operatore-studio** (questo STOP — staff che gestisce i clienti)
2. **cliente-dello-studio** (l'azienda-cliente che vede le sue comunicazioni/documenti/preventivi — secondo frontend, non esiste ancora)
3. **super-admin-piattaforma** (amministrazione studi/tenant + server + fatturazione verso gli studi via FIC — parzialmente coperto dal modulo tenants/bootstrap, sarebbe app a sé)

Più i moduli di dominio mancanti (Comunicazioni, Documenti, Circolari, Scadenze,
Questionari, Agevolazioni). Programma multi-sessione. La card-grid di questo STOP è
predisposta a ospitare le card future man mano che i moduli nascono.

## File

Backend nuovi: `apps/accountant-api/src/dashboard/{dashboard.module,dashboard.controller,dashboard.service}.ts` + e2e `dashboard-stats.e2e-spec.ts`. Mod: `app.module.ts` (registrazione).

Frontend nuovi: `lib/dashboard-{types,api}.ts` + `components/dashboard/{StatCard,UltimiPreventivi}.tsx`. Mod: `dashboard/page.tsx` (card-grid) + `i18n/{it,en}.json` (namespace dashboard esteso, 5 chiavi orfane rimosse).

## Tech debt

- **TD-RLS-dashboard candidate:** l'endpoint stats non è esercitato da rls-isolation
  e2e (suite superuser TD-BV; l'isolamento è verificato applicativamente nello scenario
  A/B di dashboard-stats + a runtime non-superuser). Coerente con TD-BV. Bassa priorità
  (gli aggregati riusano le stesse policy delle CRUD già esercitate da rls-isolation).
- Card future (Comunicazioni/Documenti/…) → quando nascono i moduli (roadmap).

## Test

e2e dashboard-stats 4 scenari (48/48 totale suite). Verifica runtime non-superuser:
numeri a schermo combaciano col DB (totale 5/4 attivi/1 non attivo/3 aziende/2 persone
fisiche; preventivi 2/€2022.80; ultimi ordinati; soft-deleted esclusi).
