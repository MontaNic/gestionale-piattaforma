// =============================================================================
// @gestionale/auth — superficie pubblica (ADR-0027 §D5 passo 7)
// Core auth multi-tenant NestJS: auth, rbac, users, tenancy (tenant + tenants),
// tenant-context. Il wiring dei 4 APP_GUARD + APP_INTERCEPTOR + middleware
// resta nello scaffold consumatore (apps/restaurant-api/src/app.module.ts).
// `health` NON rientra (resta scaffold, DP-health=A — back-ref DbService, passo 8).
// =============================================================================

// auth
export { AuthModule } from './auth/auth.module';
// AuthService + token payload: esposti per riuso del token-issuance da consumer
// app-level (es. accept-invite logga il cliente appena creato).
export { AuthService } from './auth/auth.service';
export type { AuthTokensPayload } from './auth/dto/auth-response.dto';
export { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
export { TenantConsistencyGuard } from './auth/guards/tenant-consistency.guard';
export { Public, IS_PUBLIC_KEY } from './auth/decorators/public.decorator';
export { CurrentUser } from './auth/decorators/current-user.decorator';
export type {
  AuthenticatedUser,
  AuthenticatedRequest,
} from './auth/interfaces/authenticated-request.interface';

// rbac
export { RbacModule } from './rbac/rbac.module';
export { PermissionsGuard } from './rbac/guards/permissions.guard';
export { RequirePermissions } from './rbac/decorators/require-permissions.decorator';

// users
export { UsersModule } from './users/users.module';
export { UsersService } from './users/users.service';
export type { FullProfile } from './users/users.service';

// tenancy: tenants (CRUD) + tenant (infra) + context (interceptor)
export { TenantsModule } from './tenants/tenants.module';
// TenantsService + DTO + result: riusati dal modulo platform (superadmin Task 3).
export { TenantsService } from './tenants/tenants.service';
export type { CreateTenantResult } from './tenants/tenants.service';
export { CreateTenantDto } from './tenants/dto/create-tenant.dto';
export { TenantModule } from './tenant/tenant.module';
export { TenantMiddleware } from './tenant/tenant.middleware';
export { CurrentTenant } from './tenant/decorators/current-tenant.decorator';
export { TenantContextInterceptor } from './context/tenant-context.interceptor';
