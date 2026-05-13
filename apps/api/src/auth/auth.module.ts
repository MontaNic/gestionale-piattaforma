import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
  throw new Error('JWT_SECRET env var required (apps/api AuthModule init)');
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
    // JwtAuthGuard registrato globale: ogni endpoint richiede JWT valido di
    // default; @Public() decorator opt-out (decisione E ADR-0008).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // LockoutExceptionFilter globale (B1 STOP 3): intercetta HttpException
    // con body.code='E_AUTH_ACCOUNT_LOCKED' e setta Retry-After: 900 fissi
    // (anti user-enumeration TD-J). Pass-through per altre HttpException.
    { provide: APP_FILTER, useClass: LockoutExceptionFilter },
  ],
  exports: [AuthService],
})
export class AuthModule {}
