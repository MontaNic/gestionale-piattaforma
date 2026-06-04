// =============================================================================
// current-user.decorator.ts — Inject AuthenticatedUser nel controller method
// =============================================================================
// Uso:
//   @Get()
//   handler(@CurrentUser() user: AuthenticatedUser) { ... }
//
// Il user viene attaccato a request.user da JwtStrategy.validate().
// =============================================================================

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../interfaces/authenticated-request.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user;
  },
);
