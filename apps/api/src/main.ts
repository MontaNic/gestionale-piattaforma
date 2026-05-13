// =============================================================================
// main.ts — Entrypoint apps/api (NestJS bootstrap)
// =============================================================================
// Avvia NestJS su PORT (default 3000). Reflect-metadata richiesto
// per la decorator metadata propagation (Nest DI, ParamTypes, ecc.).
// =============================================================================

import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // CORS (E2 discovery F6): primo client browser-based richiede l'header
  // Access-Control-Allow-Origin. Origin SPECIFIC (no wildcard) via env per
  // multi-env (dev/staging/prod). credentials:true preparato per futura
  // migration localStorage -> httpOnly cookie (TD-1 ADR-0012).
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
    credentials: true,
  });

  // Versionamento URL (§C2 brief): tutti gli endpoint sotto /api/v1.
  // Health/root del macro-task D1 vengono auto-prefissati.
  app.setGlobalPrefix('api/v1');

  // ValidationPipe globale: applica class-validator decorators dei DTO,
  // strip campi extra (whitelist), trasforma payload nei tipi class-transformer.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  // Abilita gli shutdown hooks (SIGTERM/SIGINT) per propagare onModuleDestroy
  // ai provider — necessario per il graceful $disconnect del Prisma client
  // gestito da DbService.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  Logger.log(`Gestionale API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  Logger.error(
    'Failed to bootstrap application',
    err instanceof Error ? err.stack : err,
    'Bootstrap',
  );
  process.exit(1);
});
