// =============================================================================
// menu-types.ts — Domain types F1 Menu UI (S19 ADR-0020)
// =============================================================================
// Shape allineata alle response backend `{ data }` di apps/api
// (menus / menu-categories / articles controllers, S17 ADR-0019).
//
// Note di serializzazione JSON:
//   - `Decimal` Prisma (`Article.basePrice`) → stringa nel body JSON.
//   - `DateTime` → stringa ISO. I timestamp non sono usati dalla UI S19 ma
//     restano tipizzati per fedeltà alla response.
//
// Scope prezzo S19: solo `Article.basePrice` (campo intrinseco articolo). Gli
// `ArticlePrice` (override per listino) NON sono gestiti in S19 — sono il
// meccanismo dei listini, UI dedicata in S20 (ADR-0020 Decision §prezzo).
// =============================================================================

export interface Menu {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MenuCategory {
  id: string;
  tenantId: string;
  menuId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type PrintDepartment = 'cucina' | 'pizzeria' | 'bar';
export type ArticleAvailability = 'in_carta' | 'esaurito' | 'sospeso';

/** Aliquote IVA IT ammesse (BRIEF L305 / CreateArticleDto `@IsIn`). */
export const VAT_RATES = [4, 10, 22] as const;
export const PRINT_DEPARTMENTS: readonly PrintDepartment[] = ['cucina', 'pizzeria', 'bar'];
export const AVAILABILITIES: readonly ArticleAvailability[] = ['in_carta', 'esaurito', 'sospeso'];

export interface Article {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  descriptionShort: string;
  descriptionLong: string | null;
  photoUrl: string | null;
  /** Prisma Decimal(10,2) → stringa JSON (es. "12.50"). */
  basePrice: string;
  vatPercent: number;
  allergens: string[];
  dietaryTags: string[];
  printDepartment: PrintDepartment;
  preparationTimeMinutes: number | null;
  availability: ArticleAvailability;
  sortOrder: number;
  channelVisibility: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// -----------------------------------------------------------------------------
// Input types (request body) — sottoinsieme dei DTO backend gestito dalla UI S19.
// allergens / dietaryTags / channelVisibility: opzionali backend (default []),
// fuori scope S19 (multi-select enum → TD-CA), omessi qui.
// -----------------------------------------------------------------------------

export interface CreateMenuInput {
  name: string;
  description?: string;
  isActive?: boolean;
  sortOrder?: number;
}
export type UpdateMenuInput = Partial<CreateMenuInput>;

export interface CreateCategoryInput {
  name: string;
  sortOrder?: number;
}
export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export interface CreateArticleInput {
  categoryId: string;
  name: string;
  descriptionShort: string;
  descriptionLong?: string;
  photoUrl?: string;
  basePrice: number;
  vatPercent: number;
  printDepartment: PrintDepartment;
  availability?: ArticleAvailability;
  preparationTimeMinutes?: number;
  sortOrder?: number;
}
/** Update articolo: `categoryId` escluso — lo spostamento tra categorie è fuori scope S19. */
export type UpdateArticleInput = Partial<Omit<CreateArticleInput, 'categoryId'>>;

/**
 * Payload prodotto da `ArticleForm` (tutti i campi articolo, senza `categoryId`).
 * Create: il parent aggiunge `categoryId`. Update: assegnabile a `UpdateArticleInput`.
 */
export type ArticleFormPayload = Omit<CreateArticleInput, 'categoryId'>;
