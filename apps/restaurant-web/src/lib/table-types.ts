// =============================================================================
// table-types.ts — Domain types F2 Tavoli / Mappa sala (ADR-0058)
// =============================================================================
// Shape allineata alla response backend `{ data }` di apps/restaurant-api
// (tables controller). Nota serializzazione: `posX`/`posY` sono Prisma `Float`
// → numeri JSON nativi (NON stringhe come i Decimal). `DateTime` → stringa ISO.
// =============================================================================

export interface Tavolo {
  id: string;
  tenantId: string;
  numero: string;
  capienza: number;
  posX: number;
  posY: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTableInput {
  numero: string;
  capienza: number;
  posX?: number;
  posY?: number;
}

/** Update tavolo: tutti opzionali — include posX/posY per persistere il drag-drop. */
export type UpdateTableInput = Partial<CreateTableInput>;
