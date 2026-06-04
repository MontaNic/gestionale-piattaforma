// =============================================================================
// articles.service.ts — CRUD Article (S17 F1 ADR-0019)
// =============================================================================
// Article e' top-level (filtrato via ?categoryId= o ?menuId=). I prezzi base
// vivono qui (basePrice), price overrides per listino sono in ArticlePrice
// (vedi article-prices.service.ts).
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Article, id, Prisma, withTenantContextAtomicTx } from '@gestionale/db';

import { catchUniqueViolation } from '@gestionale/platform';
import { DbService } from '../db/db.service';
import type { CreateArticleDto } from './dto/create-article.dto';
import type { UpdateArticleDto } from './dto/update-article.dto';

@Injectable()
export class ArticlesService {
  private readonly logger = new Logger(ArticlesService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async list(
    tenantId: string,
    filters: { categoryId?: string; menuId?: string },
  ): Promise<Article[]> {
    const where: Prisma.ArticleWhereInput = { tenantId };
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.menuId) where.category = { menuId: filters.menuId };
    return this.db.prisma.article.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getById(tenantId: string, articleId: string): Promise<Article> {
    const article = await this.db.prisma.article.findFirst({
      where: { id: articleId, tenantId },
    });
    if (!article) {
      throw new NotFoundException({
        errorCode: 'E_ARTICLE_NOT_FOUND',
        message: 'Article not found',
      });
    }
    return article;
  }

  async create(tenantId: string, userId: string, dto: CreateArticleDto): Promise<Article> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const category = await tx.menuCategory.findFirst({
        where: { id: dto.categoryId, tenantId },
        select: { id: true },
      });
      if (!category) {
        throw new NotFoundException({
          errorCode: 'E_MENU_CATEGORY_NOT_FOUND',
          message: 'Menu category not found',
        });
      }

      const existing = await tx.article.findFirst({
        where: { tenantId, categoryId: dto.categoryId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException({
          errorCode: 'E_ARTICLE_NAME_EXISTS',
          message: `Article with name '${dto.name}' already exists in this category`,
        });
      }

      const article = await catchUniqueViolation(
        () =>
          tx.article.create({
            data: {
              id: id(),
              tenantId,
              categoryId: dto.categoryId,
              name: dto.name,
              descriptionShort: dto.descriptionShort,
              descriptionLong: dto.descriptionLong,
              photoUrl: dto.photoUrl,
              basePrice: new Prisma.Decimal(dto.basePrice),
              vatPercent: dto.vatPercent,
              allergens: dto.allergens ?? [],
              dietaryTags: dto.dietaryTags ?? [],
              printDepartment: dto.printDepartment,
              preparationTimeMinutes: dto.preparationTimeMinutes,
              availability: dto.availability,
              sortOrder: dto.sortOrder ?? 0,
              channelVisibility: dto.channelVisibility ?? [],
            },
          }),
        'E_ARTICLE_NAME_EXISTS',
      );

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'article.created',
          entityType: 'Article',
          entityId: article.id,
          afterValue: {
            categoryId: article.categoryId,
            name: article.name,
            basePrice: article.basePrice.toString(),
            vatPercent: article.vatPercent,
          },
        },
      });

      this.logger.log(`Article created: ${article.id} (${article.name}) tenant=${tenantId}`);
      return article;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    articleId: string,
    dto: UpdateArticleDto,
  ): Promise<Article> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.article.findFirst({ where: { id: articleId, tenantId } });
      if (!before) {
        throw new NotFoundException({
          errorCode: 'E_ARTICLE_NOT_FOUND',
          message: 'Article not found',
        });
      }

      if (dto.categoryId && dto.categoryId !== before.categoryId) {
        const newCategory = await tx.menuCategory.findFirst({
          where: { id: dto.categoryId, tenantId },
          select: { id: true },
        });
        if (!newCategory) {
          throw new NotFoundException({
            errorCode: 'E_MENU_CATEGORY_NOT_FOUND',
            message: 'Target menu category not found',
          });
        }
      }

      const targetCategoryId = dto.categoryId ?? before.categoryId;
      const targetName = dto.name ?? before.name;
      if (
        (dto.categoryId && dto.categoryId !== before.categoryId) ||
        (dto.name && dto.name !== before.name)
      ) {
        const conflict = await tx.article.findFirst({
          where: {
            tenantId,
            categoryId: targetCategoryId,
            name: targetName,
            NOT: { id: articleId },
          },
        });
        if (conflict) {
          throw new ConflictException({
            errorCode: 'E_ARTICLE_NAME_EXISTS',
            message: `Article with name '${targetName}' already exists in this category`,
          });
        }
      }

      const updated = await catchUniqueViolation(
        () =>
          tx.article.update({
            where: { id: articleId },
            data: {
              categoryId: dto.categoryId,
              name: dto.name,
              descriptionShort: dto.descriptionShort,
              descriptionLong: dto.descriptionLong,
              photoUrl: dto.photoUrl,
              basePrice:
                dto.basePrice !== undefined ? new Prisma.Decimal(dto.basePrice) : undefined,
              vatPercent: dto.vatPercent,
              allergens: dto.allergens,
              dietaryTags: dto.dietaryTags,
              printDepartment: dto.printDepartment,
              preparationTimeMinutes: dto.preparationTimeMinutes,
              availability: dto.availability,
              sortOrder: dto.sortOrder,
              channelVisibility: dto.channelVisibility,
            },
          }),
        'E_ARTICLE_NAME_EXISTS',
      );

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'article.updated',
          entityType: 'Article',
          entityId: updated.id,
          beforeValue: {
            name: before.name,
            categoryId: before.categoryId,
            basePrice: before.basePrice.toString(),
            vatPercent: before.vatPercent,
            availability: before.availability,
          },
          afterValue: {
            name: updated.name,
            categoryId: updated.categoryId,
            basePrice: updated.basePrice.toString(),
            vatPercent: updated.vatPercent,
            availability: updated.availability,
          },
        },
      });

      return updated;
    });
  }

  async softDelete(
    tenantId: string,
    userId: string,
    articleId: string,
  ): Promise<{ id: string; deleted: true }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.article.findFirst({ where: { id: articleId, tenantId } });
      if (!before) {
        throw new NotFoundException({
          errorCode: 'E_ARTICLE_NOT_FOUND',
          message: 'Article not found',
        });
      }

      // Soft-delete esplicito (ADR-0021 §convention): update `deletedAt` sul tx —
      // tx.article.delete() escaperebbe la tx RLS via softDeleteExtension → P2025.
      await tx.article.update({ where: { id: articleId }, data: { deletedAt: new Date() } });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'article.deleted',
          entityType: 'Article',
          entityId: articleId,
          beforeValue: {
            name: before.name,
            categoryId: before.categoryId,
            basePrice: before.basePrice.toString(),
          },
        },
      });

      this.logger.log(`Article soft-deleted: ${articleId} tenant=${tenantId}`);
      return { id: articleId, deleted: true };
    });
  }
}
