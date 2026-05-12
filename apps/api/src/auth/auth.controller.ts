import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentTenant } from '../tenant/decorators/current-tenant.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import type { AuthTokensPayload } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from './interfaces/authenticated-request.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @CurrentTenant() tenantId: string | undefined,
    @Body() dto: LoginDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ data: AuthTokensPayload }> {
    if (!tenantId) throw new UnauthorizedException('E_AUTH_TENANT_REQUIRED');
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
    if (!user || !req.sessionId) throw new UnauthorizedException('E_AUTH_SESSION_INVALID');
    await this.auth.logout(req.sessionId, user.id, user.tenantId);
  }
}
