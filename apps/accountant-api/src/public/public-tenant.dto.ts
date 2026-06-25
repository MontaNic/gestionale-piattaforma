// =============================================================================
// public-tenant.dto.ts — View pubblica dell'identità di un tenant (ADR-0049)
// =============================================================================
// Shape ritornato da GET /public/tenants/:slug (endpoint @Public, no auth).
// SOLO campi sicuri: niente `id` interno, `isActive`, `deletedAt`. Lo slug è
// già noto al chiamante (è nell'URL) ma viene incluso per coerenza del payload.
// Tutti i campi identità sono nullable (assenza → sezione omessa nella UI).
// =============================================================================

export interface PublicTenantView {
  slug: string;
  name: string;
  descrizione: string | null;
  indirizzo: string | null;
  telefono: string | null;
  emailContatto: string | null;
  sitoWeb: string | null;
  logoUrl: string | null;
}
