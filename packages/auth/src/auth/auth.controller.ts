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

import { AuthStrict, LoginPinThrottle } from '@gestionale/platform';

import { CurrentTenant } from '../tenant/decorators/current-tenant.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import type { AuthTokensPayload } from './dto/auth-response.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { LoginPinDto } from './dto/login-pin.dto';
import type { PinSetupDto } from './dto/pin-setup.dto';
import type { RefreshDto } from './dto/refresh.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
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

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/forgot-password — Public (reset password flow)
  // ---------------------------------------------------------------------------
  // X-Tenant-Slug required (TenantMiddleware scoped a questo path). Response
  // SEMPRE 200 { success: true } (no oracle su esistenza email). @AuthStrict
  // rate-limita per IP (anti email-bombing).
  @Public()
  @AuthStrict()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(
    @CurrentTenant() tenantId: string | undefined,
    @Body() dto: ForgotPasswordDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ data: { success: true } }> {
    if (!tenantId) throw new UnauthorizedException(AuthErrorCode.TENANT_REQUIRED);
    const result = await this.auth.forgotPassword(tenantId, dto.email, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return { data: result };
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/reset-password — Public (reset password flow)
  // ---------------------------------------------------------------------------
  // X-Tenant-Slug required (token lookup scoped al tenant via RLS). @AuthStrict
  // rate-limita per IP. Token invalido/usato → 400 E_AUTH_RESET_TOKEN_INVALID,
  // scaduto → 400 E_AUTH_RESET_TOKEN_EXPIRED, password corta → 400 E_AUTH_PASSWORD_TOO_SHORT.
  @Public()
  @AuthStrict()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(
    @CurrentTenant() tenantId: string | undefined,
    @Body() dto: ResetPasswordDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ data: { success: true } }> {
    if (!tenantId) throw new UnauthorizedException(AuthErrorCode.TENANT_REQUIRED);
    const result = await this.auth.resetPassword(tenantId, dto.token, dto.newPassword, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return { data: result };
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
