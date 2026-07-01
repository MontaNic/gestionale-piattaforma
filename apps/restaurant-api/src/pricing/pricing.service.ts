// =============================================================================
// pricing.service.ts — Resolver prezzo-per-canale con accesso dati (PR-2, ADR-0068)
// =============================================================================
// Carica article + listini attivi + override e delega la selezione alla funzione
// pura `resolveUnitPrice`. Ritorna lo snapshot (prezzo+nome+reparto) da congelare
// sulla ContoRiga.
//
// IMPORTANTE: opera sul `tx` passato dal chiamante (dentro
// withTenantContextAtomicTx), NON su this.db.prisma — così tutte le letture
// restano nella stessa tx RLS tenant-scoped (usare il client esteso qui
// aprirebbe una tx separata senza i SET LOCAL della tx del conto).
// =============================================================================

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type Channel, type Prisma, type PrintDepartment } from '@gestionale/db';

import type { TenantTx } from '../common/tenant-tx.type';
import { PriceAmbiguousError, resolveUnitPrice } from './price-resolution';

export interface LineSnapshot {
  prezzoUnitario: Prisma.Decimal;
  nomeArticolo: string;
  reparto: PrintDepartment;
}

@Injectable()
export class PricingService {
  /**
   * Risolve lo snapshot di riga per (articolo, canale) dentro il tx del conto.
   * @throws NotFoundException E_ARTICLE_NOT_FOUND — articolo assente/non del tenant
   * @throws ConflictException E_PRICE_AMBIGUOUS — ≥2 listini attivi sul canale
   */
  async resolveLineSnapshot(
    tx: TenantTx,
    tenantId: string,
    articleId: string,
    channel: Channel,
  ): Promise<LineSnapshot> {
    const article = await tx.article.findFirst({
      where: { id: articleId, tenantId },
      select: { name: true, printDepartment: true, basePrice: true },
    });
    if (!article) {
      throw new NotFoundException({
        errorCode: 'E_ARTICLE_NOT_FOUND',
        message: 'Article not found',
      });
    }

    const lists = await tx.priceList.findMany({
      where: { tenantId, isActive: true, deletedAt: null, channels: { has: channel } },
      select: { id: true },
    });
    const matchingActiveListIds = lists.map((l) => l.id);

    const overrideByListId = new Map<string, Prisma.Decimal>();
    if (matchingActiveListIds.length > 0) {
      const overrides = await tx.articlePrice.findMany({
        where: { tenantId, articleId, priceListId: { in: matchingActiveListIds } },
        select: { priceListId: true, price: true },
      });
      for (const o of overrides) overrideByListId.set(o.priceListId, o.price);
    }

    try {
      const prezzoUnitario = resolveUnitPrice({
        basePrice: article.basePrice,
        channel,
        matchingActiveListIds,
        overrideByListId,
      });
      return { prezzoUnitario, nomeArticolo: article.name, reparto: article.printDepartment };
    } catch (err) {
      if (err instanceof PriceAmbiguousError) {
        throw new ConflictException({ errorCode: err.errorCode, message: err.message });
      }
      throw err;
    }
  }
}
