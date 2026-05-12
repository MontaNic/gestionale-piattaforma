// =============================================================================
// main.ts — Entrypoint apps/api (NestJS bootstrap)
// =============================================================================
// Avvia NestJS su PORT (default 3000). Reflect-metadata richiesto
// per la decorator metadata propagation (Nest DI, ParamTypes, ecc.).
// =============================================================================

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Abilita gli shutdown hooks (SIGTERM/SIGINT) per propagare onModuleDestroy
  // ai provider — necessario per il graceful $disconnect del Prisma client
  // gestito da DbService. Senza, il processo termina senza chiamare destroy.
  app.enableShutdownHooks();
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  Logger.log(`Gestionale API listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  Logger.error(
    'Failed to bootstrap application',
    err instanceof Error ? err.stack : err,
    'Bootstrap',
  );
  process.exit(1);
});
