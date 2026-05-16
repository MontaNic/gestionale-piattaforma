import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import type { TestContainers } from './test-containers';

// NB: AppModule import DINAMICO dentro createTestApp (post env override).
// Discovery #30 B2b: @gestionale/db ha singleton eager `prisma` che legge
// DATABASE_URL al require time. Import statico → placeholder URL singleton
// → PrismaClient auth fail con creds setup-env.ts. Lazy import garantisce
// env runtime corretto disponibile al primo require.

// =============================================================================
// test-app.ts (B2b) — NestJS bootstrap + DB utilities per E2E
// =============================================================================
// createTestApp: simmetrico a main.ts (setGlobalPrefix + ValidationPipe +
// enableShutdownHooks). Env vars override BEFORE Test.createTestingModule
// per ConfigModule.forRoot pickup.
//
// truncateDatabase: TRUNCATE CASCADE ordinato per FK invece di reset
// migrations (più veloce, ~50ms vs ~3s). UUID v7 app-side → no RESTART
// IDENTITY necessario.
//
// seedMinimal: insert raw SQL (no Prisma seed.ts completo) per velocità.
// Tenant demo + sede principale + admin@demo.local con password Admin123!.
// NO 32 permessi / 6 role templates / 104 mappings (B2b scope: smoke auth
// flow, non RBAC verifica completa).
// =============================================================================

export async function createTestApp(containers: TestContainers): Promise<INestApplication> {
  // Override env BEFORE module compile (ConfigModule.forRoot legge process.env).
  process.env.DATABASE_URL = containers.databaseUrl;
  process.env.DIRECT_URL = containers.databaseUrl;
  process.env.REDIS_HOST = containers.redisHost;
  process.env.REDIS_PORT = String(containers.redisPort);
  process.env.JWT_SECRET = 'test-jwt-secret-for-e2e-only-not-production';

  // CORS_ORIGIN: irrilevante in E2E (supertest non manda preflight), ma
  // settato per evitare warning bootstrap se la var manca.
  process.env.CORS_ORIGIN = 'http://localhost:3001';

  // MailService: SMTP_PORT=1 (porta chiusa) → transporter.verify() fail-open
  // log warn, no mail real sent. Sufficient per test che non sondano email
  // (auth-login.e2e-spec.ts). Per test futuri che sondano email content,
  // creare container Mailpit fresh in startTestContainers.
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = '1';

  // Lockout: soglie basse per test veloci.
  process.env.LOCKOUT_THRESHOLD = '3';
  process.env.LOCKOUT_WINDOW_MS = '60000';
  process.env.LOCKOUT_DURATION_MS = '5000';

  // Throttler: soglie alte per non interferire con smoke auth flow.
  // Test specifici per rate-limit dovranno override per-test se servono.
  process.env.THROTTLE_DEFAULT_LIMIT = '1000';
  process.env.THROTTLE_AUTH_LIMIT = '100';
  process.env.THROTTLE_TENANT_CREATE_LIMIT = '100';
  process.env.THROTTLE_AUTH_PIN_LIMIT = '100';

  // Lazy import POST env override — vedi Discovery #30 (singleton Prisma).
  const { AppModule } = await import('../../../src/app.module');

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  await app.init();
  return app;
}

export async function truncateDatabase(databaseUrl: string): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  // Ordine inverso FK constraint. CASCADE garantisce cleanup nested se schema
  // evolve. RESTART IDENTITY non rilevante (UUID v7 app-side).
  await client.query(`
    TRUNCATE TABLE
      audit_logs,
      sessions,
      user_roles,
      role_permissions,
      roles,
      users,
      sedi,
      tenants,
      system_role_template_permissions,
      system_role_templates,
      permissions
    RESTART IDENTITY CASCADE;
  `);
  await client.end();
}

export interface SeedResult {
  tenantId: string;
  sedeId: string;
  adminUserId: string;
}

export async function seedMinimal(databaseUrl: string): Promise<SeedResult> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const tenantId = uuidv7();
  const sedeId = uuidv7();
  const adminUserId = uuidv7();
  const adminPasswordHash = await argon2.hash('Admin123!', { type: argon2.argon2id });

  await client.query(
    `INSERT INTO tenants (id, name, slug, is_active, created_at, updated_at)
     VALUES ($1, 'Demo Tenant', 'demo', true, NOW(), NOW());`,
    [tenantId],
  );

  await client.query(
    `INSERT INTO sedi (id, tenant_id, name, address, city, postal_code, country, timezone, currency, is_active, created_at, updated_at)
     VALUES ($1, $2, 'Sede Principale', 'Via Test 1', 'Milano', '20100', 'IT', 'Europe/Rome', 'EUR', true, NOW(), NOW());`,
    [sedeId, tenantId],
  );

  await client.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
     VALUES ($1, $2, 'admin@demo.local', $3, 'Admin', 'Demo', true, 0, NOW(), NOW());`,
    [adminUserId, tenantId, adminPasswordHash],
  );

  await client.end();
  return { tenantId, sedeId, adminUserId };
}

// =============================================================================
// seedSecondTenant — aggiunge tenant 'acme' (TD-H cross-tenant lockout test PR 2)
// =============================================================================
// Chiamare DOPO seedMinimal. Crea tenant 'acme' + sede + utente con email
// configurabile (default admin@acme.local). Per smoke cross-tenant lockout
// isolation passare `email: 'admin@demo.local'` per shared-email scenario:
// stessa email su 2 tenant → 2 lockout key Redis distinte (TD-H proof).
// =============================================================================
export async function seedSecondTenant(
  databaseUrl: string,
  opts: { email?: string } = {},
): Promise<SeedResult> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const tenantId = uuidv7();
  const sedeId = uuidv7();
  const adminUserId = uuidv7();
  const adminPasswordHash = await argon2.hash('Admin123!', { type: argon2.argon2id });
  const email = opts.email ?? 'admin@acme.local';

  await client.query(
    `INSERT INTO tenants (id, name, slug, is_active, created_at, updated_at)
     VALUES ($1, 'Acme Tenant', 'acme', true, NOW(), NOW());`,
    [tenantId],
  );

  await client.query(
    `INSERT INTO sedi (id, tenant_id, name, address, city, postal_code, country, timezone, currency, is_active, created_at, updated_at)
     VALUES ($1, $2, 'Sede Acme', 'Via Acme 1', 'Roma', '00100', 'IT', 'Europe/Rome', 'EUR', true, NOW(), NOW());`,
    [sedeId, tenantId],
  );

  await client.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Admin', 'Acme', true, 0, NOW(), NOW());`,
    [adminUserId, tenantId, email, adminPasswordHash],
  );

  await client.end();
  return { tenantId, sedeId, adminUserId };
}
