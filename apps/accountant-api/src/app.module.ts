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
import { MandatiModule } from './mandati/mandati.module';
import { PrestazioniModule } from './prestazioni/prestazioni.module';
import { TariffeModule } from './tariffe/tariffe.module';
import { ScadenzeModule } from './scadenze/scadenze.module';
import { ComunicazioniModule } from './comunicazioni/comunicazioni.module';
import { DocumentiModule } from './documenti/documenti.module';
import { CircolariModule } from './circolari/circolari.module';
import { InvitiModule } from './inviti/inviti.module';
import { PlatformModule } from './platform/platform.module';
import { PublicModule } from './public/public.module';
import { CatalogoModule } from './catalogo/catalogo.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportModule } from './report/report.module';
import { AiModule } from './ai/ai.module';
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
    // Catalogo servizi: listino studio (platform + custom), riuso nei preventivi (ADR-0050).
    CatalogoModule,
    // Mandati/incarichi: lettera d'incarico da preventivo accettato (ADR-0051).
    MandatiModule,
    // Prestazioni/timesheet: ore registrate sui mandati in corso (ADR-0053).
    PrestazioniModule,
    // Tariffario orario: costo per ruolo/utente → deriva Prestazione.importo (ADR-0055).
    TariffeModule,
    // Scadenze (calendario fiscale) + categorie piattaforma/custom (STOP-scad1).
    ScadenzeModule,
    // AI: feature trasversale (GroqService + /ai/status), feature-flag su GROQ_API_KEY (ADR-0056).
    AiModule,
    // Comunicazioni: thread 1:1 studio↔cliente + allegati (ADR-0043).
    ComunicazioniModule,
    // Documenti: scambio documenti studio↔cliente + tipi platform/custom (ADR-0044).
    DocumentiModule,
    // Circolari: broadcast unidirezionale studio→clienti + macchina di stato (ADR-0045).
    CircolariModule,
    // Dashboard KPI aggregati tenant-level (read-only, STOP-dash1).
    DashboardModule,
    // Report analitici: margine per mandato/azienda (read-only, ADR-0054).
    ReportModule,
    // Inviti cliente: onboarding utenti-portale via token email (feat/invito-cliente).
    InvitiModule,
    // Platform superadmin: gestione tenant (gated PlatformGuard, Task 3).
    PlatformModule,
    // Public: superficie non autenticata tenant-facing (landing /t/<slug>, ADR-0049).
    PublicModule,
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
      // Reset password: entrambi @Public pre-auth, tenant via X-Tenant-Slug.
      // /forgot-password risolve l'utente per (tenant,email); /reset-password
      // fa lookup token scoped al tenant (RLS via req.tenantId).
      { path: 'auth/forgot-password', method: RequestMethod.POST },
      { path: 'auth/reset-password', method: RequestMethod.POST },
      // Accept-invite: @Public pre-auth, tenant via X-Tenant-Slug → req.tenantId.
      { path: 'auth/accept-invite', method: RequestMethod.POST },
      // /auth/refresh non incluso: deriva tenantId dal payload JWT del
      // refresh token (verificato in AuthService.refresh). Header non serve.
    );
  }
}
