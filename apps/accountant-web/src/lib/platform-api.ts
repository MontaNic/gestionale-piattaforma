// =============================================================================
// platform-api.ts — data access client superadmin platform (Task 3)
// =============================================================================
// Endpoint /platform/tenants (gated PlatformGuard lato BE). NO react-query.
// Token via getAccessToken(). Response in { data }.
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

import type { CreatePlatformTenantInput, PlatformTenant } from './platform-types';

interface Wrapped<T> {
  data: T;
}

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

export async function listPlatformTenants(): Promise<PlatformTenant[]> {
  const res = await apiGet<Wrapped<PlatformTenant[]>>('/platform/tenants', authOptions());
  return res.data;
}

export async function createPlatformTenant(input: CreatePlatformTenantInput): Promise<void> {
  // Il BE ritorna { data: { tenant, sede, admin, superAdminRole } }; al FE basta
  // l'esito (la lista viene rifetchata).
  await apiPost<Wrapped<unknown>>('/platform/tenants', input, authOptions());
}

export async function suspendPlatformTenant(id: string): Promise<PlatformTenant> {
  const res = await apiPatch<Wrapped<PlatformTenant>>(
    `/platform/tenants/${id}/suspend`,
    {},
    authOptions(),
  );
  return res.data;
}

export async function restorePlatformTenant(id: string): Promise<PlatformTenant> {
  const res = await apiPatch<Wrapped<PlatformTenant>>(
    `/platform/tenants/${id}/restore`,
    {},
    authOptions(),
  );
  return res.data;
}

export async function deletePlatformTenant(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/platform/tenants/${id}`, authOptions());
}
