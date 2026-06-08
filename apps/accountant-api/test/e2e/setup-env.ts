// reflect-metadata DEVE essere caricato PRIMA di qualsiasi @Injectable/@Module
// import — production main.ts lo importa al top, in test setupFiles e' il
// gate equivalente. Senza, NestJS DI riceve `undefined` per i constructor
// args perche' design:paramtypes metadata non viene materializzato.
import 'reflect-metadata';

// =============================================================================
// setup-env.ts (STOP-c1b) — Env vars necessari PRE-import moduli NestJS
// =============================================================================
// Discovery #28: alcuni moduli NestJS leggono env vars al MODULE LOAD TIME
// (top-level statement, es. `auth.module.ts` valida JWT_SECRET con throw).
// Vitest carica i moduli PRIMA di beforeAll → setup helpers in test-app.ts
// arrivano troppo tardi.
//
// Soluzione: setupFile globale (config `setupFiles` nel project e2e) che
// gira PRIMA di ogni file test, setta i defaults critici. createTestApp()
// in beforeAll può poi override valori container-specifici (REDIS_HOST/PORT,
// DATABASE_URL ottenuti runtime da Testcontainers).
//
// NB: questo file NON contiene secret reali — JWT_SECRET qui e' un dummy
// fixed per E2E test. Production usa valore generato `openssl rand -base64 48`
// in .env (gitignored).
// =============================================================================

// Critico (validato top-level in auth.module.ts):
process.env.JWT_SECRET ??= 'test-jwt-secret-for-e2e-only-not-production';

// Defaults che ConfigService legge in module factory (forRootAsync).
// createTestApp() override per container Testcontainers runtime.
process.env.DATABASE_URL ??= 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
process.env.DIRECT_URL ??= 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
process.env.REDIS_HOST ??= 'localhost';
process.env.REDIS_PORT ??= '6379';
process.env.CORS_ORIGIN ??= 'http://localhost:3003';
process.env.SMTP_HOST ??= '127.0.0.1';
process.env.SMTP_PORT ??= '1';
