// =============================================================================
// current-tenant.decorator.ts — Inject tenantId dal request
// =============================================================================
// Su endpoint protetti: tenantId proviene dal JWT (JwtStrategy.validate()
// imposta req.tenantId = payload.tenantId). Trustworthy.
// Su endpoint pubblici (pre-auth login): tenantId proviene da TenantMiddleware
// che lo deriva da header X-Tenant-Slug.
// =============================================================================

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.tenantId;
  },
);
