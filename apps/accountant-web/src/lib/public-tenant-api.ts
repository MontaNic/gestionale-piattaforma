// =============================================================================
// public-tenant-api.ts — Data access identità pubblica tenant (ADR-0049)
// =============================================================================
// Superficie PUBBLICA non autenticata: GET /public/tenants/:slug, nessun token
// (apiGet senza authOptions). Alimenta la landing /t/<slug> pre-login. Il
// backend 404 su tenant inesistente/sospeso/cancellato → ApiError gestito in
// pagina. Shape ridotto ai soli campi safe (vedi PublicTenantView backend).
// =============================================================================

import { apiGet } from '@gestionale/api-client';

interface Wrapped<T> {
  data: T;
}

export interface PublicTenant {
  slug: string;
  name: string;
  descrizione: string | null;
  indirizzo: string | null;
  telefono: string | null;
  emailContatto: string | null;
  sitoWeb: string | null;
  logoUrl: string | null;
}

export async function getPublicTenant(slug: string): Promise<PublicTenant> {
  const res = await apiGet<Wrapped<PublicTenant>>(`/public/tenants/${slug}`);
  return res.data;
}
