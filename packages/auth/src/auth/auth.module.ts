import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LockoutExceptionFilter } from './filters/lockout-exception.filter';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LockoutService } from './lockout.service';
import { JwtStrategy } from './strategies/jwt.strategy';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET env var required (apps/restaurant-api AuthModule init)');
}

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      // HS256 default. TTL gestiti per-firma (signAsync con expiresIn).
      secret: JWT_SECRET,
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LockoutService,
    // JwtAuthGuard registrato come provider regolare (non APP_GUARD qui).
    // Registrazione globale APP_GUARD avviene in app.module.ts con ordine
    // deterministico relativo a PermissionsGuard (RBAC sessione 11 ADR-0017):
    // JwtAuthGuard MUST run BEFORE PermissionsGuard per popolare req.user.
    // APP_GUARD multipli in module diversi → ordine non garantito.
    JwtAuthGuard,
    // LockoutExceptionFilter globale (B1 STOP 3): intercetta HttpException
    // con body.errorCode='E_AUTH_ACCOUNT_LOCKED' e setta Retry-After: 900 fissi
    // (anti user-enumeration TD-J). Pass-through per altre HttpException.
    // TD-AY: extends GlobalHttpExceptionFilter → shape normalizzata via super.catch().
    // DI priority: APP_FILTER runna PRIMA di useGlobalFilters (main.ts) →
    // inheritance garantisce shape consistency anche su lockout path (senza
    // inheritance, super.catch() invierebbe response bypassando il global).
    { provide: APP_FILTER, useClass: LockoutExceptionFilter },
  ],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
