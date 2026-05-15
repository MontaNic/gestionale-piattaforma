// =============================================================================
// require-permissions.decorator.ts — @RequirePermissions decorator (RBAC)
// =============================================================================
// Protegge endpoint con check permission lazy lookup (no JWT eager payload —
// vedi ADR-0008 decisione 7 + ADR-0010 rejected eager). Storage tramite
// SetMetadata(PERMISSIONS_METADATA_KEY), letto da PermissionsGuard.
//
// Usage:
//   @RequirePermissions('users.read')                          // 1 permission
//   @RequirePermissions('users.read', 'users.write')           // AND default
//   @RequirePermissions({ mode: 'OR' }, 'admin', 'manager')    // OR opt-in
//
// Permission codes seedati: vedi packages/db/prisma/seed.ts § 32 permessi
// (es. 'sistema.tenant.gestisci', 'menu.piatto.crea', 'cassa.scontrino.emetti').
// =============================================================================

import { SetMetadata } from '@nestjs/common';

import {
  PERMISSIONS_METADATA_KEY,
  type PermissionsMetadata,
  type PermissionsMode,
} from '../interfaces/permissions-metadata.interface';

interface PermissionOptions {
  mode: PermissionsMode;
}

export function RequirePermissions(
  ...permissions: readonly string[]
): MethodDecorator & ClassDecorator;
export function RequirePermissions(
  options: PermissionOptions,
  ...permissions: readonly string[]
): MethodDecorator & ClassDecorator;
export function RequirePermissions(
  optionsOrFirst?: PermissionOptions | string,
  ...rest: readonly string[]
): MethodDecorator & ClassDecorator {
  let mode: PermissionsMode = 'AND';
  let permissions: readonly string[];

  // NB: chiamare RequirePermissions() zero-arg matcha la prima overload
  // (rest param zero); l'implementation signature riceve optionsOrFirst=undefined.
  // Discriminazione esplicita sui 3 casi (object/string/undefined) evita
  // [undefined] come permission valida.
  if (typeof optionsOrFirst === 'object' && optionsOrFirst !== null && 'mode' in optionsOrFirst) {
    mode = optionsOrFirst.mode;
    permissions = rest;
  } else if (typeof optionsOrFirst === 'string') {
    permissions = [optionsOrFirst, ...rest];
  } else {
    // optionsOrFirst === undefined → caller ha invocato senza args
    permissions = rest;
  }

  if (permissions.length === 0) {
    throw new Error(
      '@RequirePermissions: almeno una permission richiesta. ' +
        'Pattern: @RequirePermissions("p1") oppure @RequirePermissions({mode:"OR"}, "p1", "p2")',
    );
  }

  const metadata: PermissionsMetadata = { mode, permissions };
  return SetMetadata(PERMISSIONS_METADATA_KEY, metadata);
}
