// =============================================================================
// permissions-metadata.interface.ts — Metadata shape per @RequirePermissions
// =============================================================================
// Letto da PermissionsGuard via Reflector.getAllAndOverride().
//
// Pattern coerente con NestJS Guard standard:
// - METADATA_KEY const string per Reflector lookup
// - PermissionsMetadata = options object con mode + lista codes
//
// Mode default = 'AND' (least-privilege). 'OR' opt-in esplicito.
// =============================================================================

export const PERMISSIONS_METADATA_KEY = 'rbac:required-permissions';

export type PermissionsMode = 'AND' | 'OR';

export interface PermissionsMetadata {
  mode: PermissionsMode;
  permissions: readonly string[];
}

/**
 * Options object per @RequirePermissions decorator signature overload.
 * Permette esplicito opt-in OR mode: @RequirePermissions({ mode: 'OR' }, 'p1', 'p2')
 */
export interface PermissionOptions {
  mode: PermissionsMode;
}
