// =============================================================================
// dashboard.service.ts — KPI aggregati tenant-level food (ADR-0084)
// =============================================================================
// PRIMO uso di query aggregate del verticale FOOD (`restaurant-api` non aveva
// alcun modulo stats prima di questa PR). Il precedente di riferimento è
// `accountant-api/src/dashboard/dashboard.service.ts` (ADR-0038), da cui questo
// modulo eredita il pattern; le divergenze sono elencate in ADR-0084 §Decisioni.
//
// Aggregati sotto RLS senza wrap esplicito: count/aggregate sono model-op →
// passano per `$allOperations` dell'extension rls.ts → girano sotto il tenant
// context dell'interceptor con SET LOCAL app.tenant_id (ADR-0009). La
// softDeleteExtension intercetta anche count/aggregate e inietta
// `where.deletedAt = null` sui SOLI modelli che hanno il campo (gate
// `modelsWithDeletedAt`) → `Conto`/`Comanda` sì, `Pagamento` no (non ha
// `deletedAt`: lo storno è il flag `stornato`). Passiamo comunque `deletedAt:
// null` esplicito dove il campo esiste: rende leggibile l'intenzione al
// call-site e non dipende dal comportamento dell'extension.
//
// `where: { tenantId }` esplicito = difesa in-depth oltre RLS, coerente col
// pattern di conti.service / comande.service.
//
// Read-only puro: nessuna scrittura, nessun audit (non c'è nulla da tracciare in
// una lettura aggregata), nessun tocco ai service di dominio.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';
import { StatoComanda, StatoConto } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';

import type { DashboardStats } from './dto/dashboard-stats.dto';

/**
 * Fuso del "giorno di servizio" (ADR-0084). Costante, non configurabile per
 * tenant: oggi ogni tenant food è in Italia. Il giorno in cui esisterà un tenant
 * fuori fuso, questa costante diventa un campo su `Tenant` — e resta l'unico
 * punto da cambiare.
 */
export const SERVICE_TIME_ZONE = 'Europe/Rome';

/**
 * Offset (ms) della timezone rispetto a UTC nell'istante dato — positivo se la
 * zona è avanti. Ricavato da `Intl` senza dipendenze esterne: formattiamo
 * l'istante come wall-clock nella zona e lo rileggiamo come se fosse UTC; la
 * differenza è l'offset. `formatToParts` non espone i millisecondi → tronchiamo
 * l'istante al secondo su entrambi i lati della sottrazione.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const wall: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') wall[p.type] = p.value;
  }

  const asUtc = Date.UTC(
    Number(wall.year),
    Number(wall.month) - 1,
    Number(wall.day),
    // `hour12: false` può rendere la mezzanotte come "24" in alcune ICU: %24.
    Number(wall.hour) % 24,
    Number(wall.minute),
    Number(wall.second),
  );

  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

/**
 * Istante UTC corrispondente alla mezzanotte locale del giorno che contiene
 * `instant` nella timezone data.
 *
 * Due passaggi, e il secondo NON è difensivo: nei giorni di cambio ora l'offset
 * a mezzanotte differisce da quello dell'istante corrente, e il candidato
 * calcolato col primo offset cadrebbe nel giorno sbagliato. Ricalcolando
 * l'offset SUL candidato e riapplicandolo si ottiene la mezzanotte vera in
 * entrambe le direzioni del cambio (verificato in dashboard.service.spec.ts sui
 * due switch 2026).
 *
 * In Europe/Rome il cambio avviene alle 02:00/03:00 locali → la mezzanotte
 * esiste sempre e non è mai ambigua: nessun caso "ora inesistente" da gestire.
 */
export function startOfDayInTimeZone(instant: Date, timeZone: string): Date {
  const offsetAtInstant = zoneOffsetMs(instant, timeZone);
  const wallClock = new Date(instant.getTime() + offsetAtInstant);
  const midnightAsUtc = Date.UTC(
    wallClock.getUTCFullYear(),
    wallClock.getUTCMonth(),
    wallClock.getUTCDate(),
  );

  const candidate = new Date(midnightAsUtc - offsetAtInstant);
  const offsetAtMidnight = zoneOffsetMs(candidate, timeZone);
  if (offsetAtMidnight === offsetAtInstant) return candidate;
  return new Date(midnightAsUtc - offsetAtMidnight);
}

/** Comande "in corso" per il KDS: consegnate ma non ancora pronte. */
const STATI_IN_CORSO = [StatoComanda.inviata, StatoComanda.in_preparazione];

@Injectable()
export class DashboardService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async getStats(tenantId: string, now: Date = new Date()): Promise<DashboardStats> {
    const prisma = this.db.prisma;
    const inizioGiornata = startOfDayInTimeZone(now, SERVICE_TIME_ZONE);

    const [contiAperti, comandeInCorso, incasso, coperti] = await Promise.all([
      // Fotografia, NON un dato di giornata: un conto aperto ieri e mai chiuso
      // deve comparire qui — è esattamente l'anomalia che il numero serve a far
      // notare. Nessun filtro su `apertoIl`.
      prisma.conto.count({
        where: { tenantId, stato: StatoConto.aperto, deletedAt: null },
      }),

      prisma.comanda.count({
        where: { tenantId, stato: { in: STATI_IN_CORSO }, deletedAt: null },
      }),

      // ⚠️ Nessun filtro sullo stato del conto: `annulla` non ha guardia di
      // saldo (a differenza di `chiudi`), quindi un conto annullato PUÒ avere
      // un pagamento non stornato. Quel denaro è stato incassato davvero, e lo
      // storno è la via esplicita per farlo uscire dal totale — perciò
      // `stornato: false` è l'unico predicato corretto qui.
      prisma.pagamento.aggregate({
        where: { tenantId, stornato: false, createdAt: { gte: inizioGiornata } },
        _sum: { importo: true },
      }),

      // Coperti dei conti APERTI oggi, inclusi quelli già chiusi nel frattempo
      // (il filtro è su `apertoIl`, non sullo stato): a fine servizio la
      // maggioranza dei conti di giornata è chiusa, e un numero che li
      // escludesse crollerebbe proprio quando serve leggerlo.
      prisma.conto.aggregate({
        where: { tenantId, apertoIl: { gte: inizioGiornata }, deletedAt: null },
        _sum: { coperti: true },
      }),
    ]);

    // `_sum` è null quando nessuna riga matcha → "0.00", non un errore. Un
    // Decimal(0) è comunque un oggetto (truthy): il ramo `else` copre solo il
    // caso "nessun pagamento".
    const sommaIncasso = incasso._sum.importo;

    return {
      contiAperti,
      comandeInCorso,
      incassoOggi: sommaIncasso ? sommaIncasso.toFixed(2) : '0.00',
      // `coperti` è nullable sul modello (asporto non ha coperti): la Σ ignora
      // i NULL e vale null se non c'è nessuna riga → 0.
      copertiOggi: coperti._sum.coperti ?? 0,
    };
  }
}
