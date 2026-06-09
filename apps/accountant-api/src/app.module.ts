import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  AppThrottlerGuard,
  AppThrottlerModule,
  MailModule,
  RedisModule,
} from '@gestionale/platform';
import {
  AuthModule,
  JwtAuthGuard,
  PermissionsGuard,
  RbacModule,
  TenantConsistencyGuard,
  TenantContextInterceptor,
  TenantMiddleware,
  TenantModule,
  TenantsModule,
  UsersModule,
} from '@gestionale/auth';

import { AppController } from './app.controller';
import { AziendeModule } from './aziende/aziende.module';
import { ReferentiModule } from './referenti/referenti.module';
import { PreventiviModule } from './preventivi/preventivi.module';
import { DbModule } from '@gestionale/db/nest';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';

@Module({
  imports: [
    // ConfigModule globale: rende ConfigService DI-iniettabile ovunque senza
    // re-import. Le env vars sono gia' caricate da dotenv-cli wrapper degli
    // script dev/start:prod (vedi package.json apps/accountant-api), quindi qui niente
    // envFilePath: ConfigService legge process.env.
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    RedisModule,
    MailModule,
    AppThrottlerModule,
    TenantModule,
    UsersModule,
    AuthModule,
    MeModule,
    HealthModule,
    TenantsModule,
    RbacModule,
    // Modulo dominio del verticale accountant (prima slice STOP-c1).
    AziendeModule,
    // Satellite 1:N di aziende (referenti, STOP-c3a).
    ReferentiModule,
    // Preventivi (testata + voci, business logic + tx atomica, STOP-e1).
    PreventiviModule,
  ],
  controllers: [AppController],
  providers: [
    // TenantContextInterceptor registrato globale: wrappa ogni handler in
    // AsyncLocalStorage RLS context se req.tenantId presente. Vedi ADR-0009.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    // AppThrottlerGuard globale (B1, fase 2): extends ThrottlerGuard.
    // - Applica il throttler `default` a TUTTI gli endpoint.
    // - I throttler `auth-strict` e `tenant-create` sono opt-in via metadata
    //   flag (@AuthStrict / @TenantCreate decorators) + skipIf nella forRoot.
    // - Override getTracker(): per `tenant-create` usa userId-or-IP (decode
    //   JWT minimale dall'Authorization header). Vedi guard sorgente.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    // ORDINE GUARD CRITICO (sessione 11 ADR-0017, Discovery #36): APP_GUARD
    // multipli in module diversi NON hanno ordine garantito. Registrazione
    // centralizzata qui (vs distribuita cross-module pre-fix: JwtAuthGuard
    // era APP_GUARD in auth.module.ts → race ordering con PermissionsGuard)
    // garantisce sequence deterministica per providers array di app.module:
    //   1. AppThrottlerGuard (rate-limit, no req.user dependency)
    //   2. JwtAuthGuard (auth, popola req.user)
    //   3. TenantConsistencyGuard (defense-in-depth cross-tenant, sessione 16
    //      ADR-0012 §TD-7 closure, Discovery #50): compara JWT.tenantId vs
    //      header X-Tenant-Slug. Skip @Public / req.user assente / header
    //      assente. Cache Redis TTL 60s + fallback Postgres.
    //   4. PermissionsGuard (RBAC, legge req.user popolato da #2)
    // JwtAuthGuard globale: ogni endpoint richiede JWT valido di default;
    // @Public() decorator opt-out (decisione E ADR-0008).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantConsistencyGuard },
    // PermissionsGuard globale: legge metadata @RequirePermissions(...) via
    // Reflector. Endpoint SENZA decorator → allow (opt-in). Lazy lookup
    // permission via UsersService.hasPermission con cache Redis TTL 60s +
    // audit auth.permission_denied automatico (no JWT eager — ADR-0008
    // dec.7 + ADR-0010 rejected eager payload).
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // TenantMiddleware applicato SOLO a endpoint pre-auth (login, refresh) che
    // non hanno un JWT da cui derivare il tenantId. Sugli endpoint protetti
    // post-auth, JwtStrategy.validate() imposta req.tenantId dal payload JWT
    // (anti-spoofing, vedi ADR-0008 decisione B). Su endpoint Public come
    // /health o / il tenant non serve.
    consumer.apply(TenantMiddleware).forRoutes(
      { path: 'auth/login', method: RequestMethod.POST },
      // D2b: /auth/login-pin richiede tenant resolution via header (pre-auth).
      { path: 'auth/login-pin', method: RequestMethod.POST },
      // /auth/refresh non incluso: deriva tenantId dal payload JWT del
      // refresh token (verificato in AuthService.refresh). Header non serve.
    );
  }
}
