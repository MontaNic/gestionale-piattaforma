// =============================================================================
// jwt-auth.guard.ts — Estensione di AuthGuard('jwt') con bypass @Public()
// =============================================================================
// Pattern security-by-default: registrato APP_GUARD globale in AuthModule.
// Endpoint pubblici dichiarano @Public() e questo guard li lascia passare
// senza tentare validation del JWT.
// =============================================================================

import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
