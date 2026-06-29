// =============================================================================
// tables.controller.ts — REST /tables (F2 Mappa sala, ADR-0058)
// =============================================================================
// Pattern replicato 1:1 da menus.controller.ts.
// Protection: JwtAuthGuard globale + @RequirePermissions.
// TenantConsistencyGuard cattura cross-tenant by default.
//   - GET (list/getById)        -> tavoli.visualizza
//   - POST / PATCH / DELETE      -> tavoli.gestisci
// =============================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TablesService } from './tables.service';
import { AuthErrorCode } from '@gestionale/shared';

@Controller('tables')
export class TablesController {
  constructor(@Inject(TablesService) private readonly tables: TablesService) {}

  @Get()
  @RequirePermissions('tavoli.visualizza')
  async list(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tables.list(user.tenantId);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('tavoli.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tables.getById(user.tenantId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('tavoli.gestisci')
  async create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateTableDto) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tables.create(user.tenantId, user.id, dto);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('tavoli.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tables.update(user.tenantId, user.id, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('tavoli.gestisci')
  async softDelete(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tables.softDelete(user.tenantId, user.id, id);
    return { data };
  }
}
