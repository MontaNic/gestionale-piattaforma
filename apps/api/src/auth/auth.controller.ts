import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentTenant } from '../tenant/decorators/current-tenant.decorator';
import { AuthStrict } from '../throttler/decorators/auth-strict.decorator';
import { LoginPinThrottle } from '../throttler/decorators/login-pin.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import type { AuthTokensPayload } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { LoginPinDto } from './dto/login-pin.dto';
import { PinSetupDto } from './dto/pin-setup.dto';
import { RefreshDto } from './dto/refresh.dto';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from './interfaces/authenticated-request.interface';
import { AuthErrorCode } from '@gestionale/shared';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @AuthStrict()
  @Post('login')
  async login(
    @CurrentTenant() tenantId: string | undefined,
    @Body() dto: LoginDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ data: AuthTokensPayload }> {
    if (!tenantId) throw new UnauthorizedException(AuthErrorCode.TENANT_REQUIRED);
    const tokens = await this.auth.login(tenantId, dto.email, dto.password, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return { data: tokens };
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ data: AuthTokensPayload }> {
    const tokens = await this.auth.refresh(dto.refreshToken, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return { data: tokens };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    if (!user || !req.sessionId) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    await this.auth.logout(req.sessionId, user.id, user.tenantId);
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/pin-setup — Protected (D2b)
  // ---------------------------------------------------------------------------
  // Re-auth con currentPassword + PIN format/uniqueness check + hash + save.
  // Idempotente per overwrite (audit distingue setup vs reset).
  @Post('pin-setup')
  async pinSetup(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: PinSetupDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ data: { success: true } }> {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const result = await this.auth.setupPin(user.id, user.tenantId, dto.currentPassword, dto.pin, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return { data: result };
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/login-pin — Public (D2b)
  // ---------------------------------------------------------------------------
  // X-Tenant-Slug required (TenantMiddleware scoped a questo path).
  // PIN match via argon2.verify loop sui user del tenant + sessione POS.
  @Public()
  // B2a: @AuthStrict() rimosso da /auth/login-pin → subsumed da
  // @LoginPinThrottle() che e' piu' granulare (per-tenant tracker) e piu'
  // permissivo (10/min vs 5/min). Mantenere entrambi fa vincere auth-strict
  // (IP-only) annullando il tracker per-tenant. Discovery #25 ADR-0014.
  // /auth/login (email/password) mantiene @AuthStrict() — quel flow non ha
  // tenant scope per-tracker (TD-H carry-over B1).
  @LoginPinThrottle()
  @Post('login-pin')
  async loginPin(
    @CurrentTenant() tenantId: string | undefined,
    @Body() dto: LoginPinDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ data: AuthTokensPayload }> {
    if (!tenantId) throw new UnauthorizedException(AuthErrorCode.TENANT_REQUIRED);
    const tokens = await this.auth.loginPin(tenantId, dto.pin, dto.deviceId, dto.deviceType, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return { data: tokens };
  }
}
