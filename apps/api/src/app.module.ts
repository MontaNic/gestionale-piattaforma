import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { TenantContextInterceptor } from './context/tenant-context.interceptor';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { MeModule } from './me/me.module';
import { RedisModule } from './redis/redis.module';
import { TenantMiddleware } from './tenant/tenant.middleware';
import { TenantModule } from './tenant/tenant.module';
import { TenantsModule } from './tenants/tenants.module';
import { AppThrottlerGuard } from './throttler/guards/app-throttler.guard';
import { AppThrottlerModule } from './throttler/throttler.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // ConfigModule globale: rende ConfigService DI-iniettabile ovunque senza
    // re-import. Le env vars sono gia' caricate da dotenv-cli wrapper degli
    // script dev/start:prod (vedi package.json apps/api), quindi qui niente
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
