// =============================================================================
// article-prices.service.ts — Price overrides per listino (S17 F1 ADR-0019)
// =============================================================================
// POST = upsert su (articleId, priceListId) - audit action 'article_price.set'.
// PATCH/DELETE per ArticlePrice.id.
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type ArticlePrice, id, Prisma, withTenantContextAtomicTx } from '@gestionale/db';

import { DbService } from '../db/db.service';
import type { SetArticlePriceDto, UpdateArticlePriceDto } from './dto/set-article-price.dto';

@Injectable()
export class ArticlePricesService {
  private readonly logger = new Logger(ArticlePricesService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async listByArticle(tenantId: string, articleId: string): Promise<ArticlePrice[]> {
    const article = await this.db.prisma.article.findFirst({
      where: { id: articleId, tenantId },
      select: { id: true },
    });
    if (!article) {
      throw new NotFoundException({
        errorCode: 'E_ARTICLE_NOT_FOUND',
        message: 'Article not found',
      });
    }
    return this.db.prisma.articlePrice.findMany({
      where: { tenantId, articleId },
      orderBy: { priceListId: 'asc' },
    });
  }

  /**
   * Upsert price per (articleId, priceListId). Idempotent: re-call su stessa
   * coppia aggiorna il valore.
   */
  async setPrice(
    tenantId: string,
    userId: string,
    articleId: string,
    dto: SetArticlePriceDto,
  ): Promise<ArticlePrice> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const article = await tx.article.findFirst({
        where: { id: articleId, tenantId },
        select: { id: true },
      });
      if (!article) {
        throw new NotFoundException({
          errorCode: 'E_ARTICLE_NOT_FOUND',
          message: 'Article not found',
        });
      }

      const priceList = await tx.priceList.findFirst({
        where: { id: dto.priceListId, tenantId },
        select: { id: true },
      });
      if (!priceList) {
        throw new NotFoundException({
          errorCode: 'E_PRICE_LIST_NOT_FOUND',
          message: 'Price list not found',
        });
      }

      const before = await tx.articlePrice.findFirst({
        where: { articleId, priceListId: dto.priceListId },
      });

      const decimalPrice = new Prisma.Decimal(dto.price);
      let result;
      if (before) {
        result = await tx.articlePrice.update({
          where: { id: before.id },
          data: { price: decimalPrice },
        });
      } else {
        result = await tx.articlePrice.create({
          data: {
            id: id(),
            tenantId,
            articleId,
            priceListId: dto.priceListId,
            price: decimalPrice,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'article_price.set',
          entityType: 'ArticlePrice',
          entityId: result.id,
          beforeValue: before
            ? { price: before.price.toString(), priceListId: before.priceListId }
            : Prisma.DbNull,
          afterValue: { price: result.price.toString(), priceListId: result.priceListId },
        },
      });

      this.logger.log(
        `ArticlePrice ${before ? 'updated' : 'created'}: ${result.id} article=${articleId} list=${dto.priceListId}`,
      );
      return result;
    });
  }

  async updatePrice(
    tenantId: string,
    userId: string,
    articleId: string,
    priceId: string,
    dto: UpdateArticlePriceDto,
  ): Promise<ArticlePrice> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.articlePrice.findFirst({
        where: { id: priceId, tenantId, articleId },
      });
      if (!before) {
        throw new NotFoundException({
          errorCode: 'E_ARTICLE_PRICE_NOT_FOUND',
          message: 'Article price entry not found',
        });
      }

      if (dto.price === undefined) {
        throw new ConflictException({
          errorCode: 'E_ARTICLE_PRICE_EMPTY_PATCH',
          message: 'No fields to update',
        });
      }

      const updated = await tx.articlePrice.update({
        where: { id: priceId },
        data: { price: new Prisma.Decimal(dto.price) },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'article_price.updated',
          entityType: 'ArticlePrice',
          entityId: updated.id,
          beforeValue: { price: before.price.toString() },
          afterValue: { price: updated.price.toString() },
        },
      });

      return updated;
    });
  }

  async removePrice(
    tenantId: string,
    userId: string,
    articleId: string,
    priceId: string,
  ): Promise<{ id: string; deleted: true }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.articlePrice.findFirst({
        where: { id: priceId, tenantId, articleId },
      });
      if (!before) {
        throw new NotFoundException({
          errorCode: 'E_ARTICLE_PRICE_NOT_FOUND',
          message: 'Article price entry not found',
        });
      }

      // ArticlePrice e' join puro NO soft-delete: hard delete via $executeRawUnsafe-equivalent
      // Prisma client delete (extension non intercetta perche' modello NON ha deletedAt).
      await tx.articlePrice.delete({ where: { id: priceId } });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'article_price.removed',
          entityType: 'ArticlePrice',
          entityId: priceId,
          beforeValue: { price: before.price.toString(), priceListId: before.priceListId },
        },
      });

      this.logger.log(`ArticlePrice removed: ${priceId} article=${articleId}`);
      return { id: priceId, deleted: true };
    });
  }
}
