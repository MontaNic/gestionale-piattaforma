// =============================================================================
// authenticated-request.interface.ts — Express Request esteso post-auth
// =============================================================================
// JwtStrategy.validate() attacca `user` + `sessionId` + `tenantId` su request.
// TenantMiddleware (pre-auth path) attacca `tenantId` da X-Tenant-Slug.
// =============================================================================

import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  sessionId?: string;
  tenantId?: string;
}
