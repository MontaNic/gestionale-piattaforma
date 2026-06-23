// =============================================================================
// authenticated-request.interface.ts — Express Request esteso post-auth
// =============================================================================
// JwtStrategy.validate() attacca `user` + `sessionId` + `tenantId` su request.
// TenantMiddleware (pre-auth path) attacca `tenantId` da X-Tenant-Slug.
// =============================================================================

import type { Request } from 'express';
import type { ClienteRuolo, UserTipo } from '@gestionale/db';

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  // [livello 2 — portale cliente, ADR-0046] discriminatore + scoping azienda.
  // aziendaId/clienteRuolo valorizzati solo per tipo='cliente' (CHECK DB).
  tipo: UserTipo;
  aziendaId: string | null;
  clienteRuolo: ClienteRuolo | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  sessionId?: string;
  tenantId?: string;
}
