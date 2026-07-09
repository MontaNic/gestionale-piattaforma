// =============================================================================
// menu-api.ts — Data access client F1 Menu UI (S19 ADR-0020)
// =============================================================================
// Funzioni tipizzate sopra i wrapper `lib/api.ts` (apiGet/apiPost/apiPatch/
// apiDelete). NO react-query / SWR / Server Actions (confine S19) — il caller
// (page/component client) chiama queste funzioni dentro `useEffect`/handler e
// gestisce stato React locale + refetch on mutation.
//
// Token: letto da localStorage via `getAccessToken()` (pattern pre-TD-1,
// coerente con AuthContext). Ogni response backend è avvolta in `{ data }`
// — queste funzioni la srotolano e ritornano il payload diretto.
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

import type {
  Article,
  ArticlePrice,
  CreateArticleInput,
  CreateCategoryInput,
  CreateMenuInput,
  CreatePriceListInput,
  Menu,
  MenuCategory,
  PriceList,
  SetArticlePriceInput,
  UpdateArticleInput,
  UpdateArticlePriceInput,
  UpdateCategoryInput,
  UpdateMenuInput,
  UpdatePriceListInput,
} from './menu-types';

interface Wrapped<T> {
  data: T;
}

// ── Menu ─────────────────────────────────────────────────────────────────────

export async function listMenus(): Promise<Menu[]> {
  const res = await apiGet<Wrapped<Menu[]>>('/menus', authOptions());
  return res.data;
}

export async function getMenu(menuId: string): Promise<Menu> {
  const res = await apiGet<Wrapped<Menu>>(`/menus/${menuId}`, authOptions());
  return res.data;
}

export async function createMenu(input: CreateMenuInput): Promise<Menu> {
  const res = await apiPost<Wrapped<Menu>>('/menus', input, authOptions());
  return res.data;
}

export async function updateMenu(menuId: string, input: UpdateMenuInput): Promise<Menu> {
  const res = await apiPatch<Wrapped<Menu>>(`/menus/${menuId}`, input, authOptions());
  return res.data;
}

export async function deleteMenu(menuId: string): Promise<void> {
  await apiDelete<Wrapped<unknown>>(`/menus/${menuId}`, authOptions());
}

// ── MenuCategory (nested /menus/:menuId/categories) ──────────────────────────

export async function listCategories(menuId: string): Promise<MenuCategory[]> {
  const res = await apiGet<Wrapped<MenuCategory[]>>(`/menus/${menuId}/categories`, authOptions());
  return res.data;
}

export async function createCategory(
  menuId: string,
  input: CreateCategoryInput,
): Promise<MenuCategory> {
  const res = await apiPost<Wrapped<MenuCategory>>(
    `/menus/${menuId}/categories`,
    input,
    authOptions(),
  );
  return res.data;
}

export async function updateCategory(
  menuId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<MenuCategory> {
  const res = await apiPatch<Wrapped<MenuCategory>>(
    `/menus/${menuId}/categories/${categoryId}`,
    input,
    authOptions(),
  );
  return res.data;
}

export async function deleteCategory(menuId: string, categoryId: string): Promise<void> {
  await apiDelete<Wrapped<unknown>>(`/menus/${menuId}/categories/${categoryId}`, authOptions());
}

// ── Article (top-level /articles, filtro ?categoryId=) ───────────────────────

export async function listArticlesByCategory(categoryId: string): Promise<Article[]> {
  const res = await apiGet<Wrapped<Article[]>>(
    `/articles?categoryId=${encodeURIComponent(categoryId)}`,
    authOptions(),
  );
  return res.data;
}

export async function createArticle(input: CreateArticleInput): Promise<Article> {
  const res = await apiPost<Wrapped<Article>>('/articles', input, authOptions());
  return res.data;
}

export async function updateArticle(
  articleId: string,
  input: UpdateArticleInput,
): Promise<Article> {
  const res = await apiPatch<Wrapped<Article>>(`/articles/${articleId}`, input, authOptions());
  return res.data;
}

export async function deleteArticle(articleId: string): Promise<void> {
  await apiDelete<Wrapped<unknown>>(`/articles/${articleId}`, authOptions());
}

// ── PriceList (tenant-level /price-lists, S20 ADR-0022) ──────────────────────

export async function listPriceLists(): Promise<PriceList[]> {
  const res = await apiGet<Wrapped<PriceList[]>>('/price-lists', authOptions());
  return res.data;
}

export async function getPriceList(priceListId: string): Promise<PriceList> {
  const res = await apiGet<Wrapped<PriceList>>(`/price-lists/${priceListId}`, authOptions());
  return res.data;
}

export async function createPriceList(input: CreatePriceListInput): Promise<PriceList> {
  const res = await apiPost<Wrapped<PriceList>>('/price-lists', input, authOptions());
  return res.data;
}

export async function updatePriceList(
  priceListId: string,
  input: UpdatePriceListInput,
): Promise<PriceList> {
  const res = await apiPatch<Wrapped<PriceList>>(
    `/price-lists/${priceListId}`,
    input,
    authOptions(),
  );
  return res.data;
}

export async function deletePriceList(priceListId: string): Promise<void> {
  await apiDelete<Wrapped<unknown>>(`/price-lists/${priceListId}`, authOptions());
}

// ── ArticlePrice (override per listino, nested /articles/:articleId/prices) ───

export async function listArticlePrices(articleId: string): Promise<ArticlePrice[]> {
  const res = await apiGet<Wrapped<ArticlePrice[]>>(`/articles/${articleId}/prices`, authOptions());
  return res.data;
}

/** POST = upsert su (articleId, priceListId): re-call sulla stessa coppia aggiorna. */
export async function setArticlePrice(
  articleId: string,
  input: SetArticlePriceInput,
): Promise<ArticlePrice> {
  const res = await apiPost<Wrapped<ArticlePrice>>(
    `/articles/${articleId}/prices`,
    input,
    authOptions(),
  );
  return res.data;
}

export async function updateArticlePrice(
  articleId: string,
  priceId: string,
  input: UpdateArticlePriceInput,
): Promise<ArticlePrice> {
  const res = await apiPatch<Wrapped<ArticlePrice>>(
    `/articles/${articleId}/prices/${priceId}`,
    input,
    authOptions(),
  );
  return res.data;
}

export async function deleteArticlePrice(articleId: string, priceId: string): Promise<void> {
  await apiDelete<Wrapped<unknown>>(`/articles/${articleId}/prices/${priceId}`, authOptions());
}
