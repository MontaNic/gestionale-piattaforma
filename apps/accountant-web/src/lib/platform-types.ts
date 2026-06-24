// =============================================================================
// platform-types.ts — tipi client superadmin platform (Task 3)
// =============================================================================
// Wire: createdAt è ISO string (Prisma DateTime → string sul JSON).
// =============================================================================

/** Slug well-known del tenant di piattaforma (gating FE). Combacia col seed. */
export const PLATFORM_SLUG = 'oneplatform';

export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreatePlatformTenantInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;
}
