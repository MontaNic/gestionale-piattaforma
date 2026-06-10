import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import type { TestContainers } from './test-containers';

// NB: AppModule import DINAMICO dentro createTestApp (post env override).
// Discovery #30: @gestionale/db ha singleton eager `prisma` che legge
// DATABASE_URL al require time. Import statico → placeholder URL singleton
// → PrismaClient auth fail con creds setup-env.ts. Lazy import garantisce
// env runtime corretto disponibile al primo require.

// =============================================================================
// test-app.ts (STOP-c1b) — NestJS bootstrap + DB utilities per E2E
// =============================================================================
// Replicato da apps/restaurant-api/test/e2e/helpers/test-app.ts, adattato
// all'AppModule di accountant-api (lazy import ../../../src/app.module).
//
// createTestApp: simmetrico a main.ts (setGlobalPrefix + ValidationPipe +
// enableShutdownHooks). Env vars override BEFORE Test.createTestingModule
// per ConfigModule.forRoot pickup.
//
// NB TD-BS Sub-2: la ValidationPipe e' montata qui MA i plugin SWC del config
// vitest NON vengono ereditati nei test.projects → niente design:paramtypes
// runtime per i DTO → la pipe non valida i constraint. La validation 400 resta
// coperta dagli unit DTO (c1); la e2e copre CRUD/RBAC/isolamento.
//
// truncateDatabase: TRUNCATE CASCADE ordinato per FK (più veloce di reset).
// seedMinimal: insert raw SQL (no Prisma seed.ts completo) per velocità.
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
  process.env.CORS_ORIGIN = 'http://localhost:3003';

  // MailService: SMTP_PORT=1 (porta chiusa) → transporter.verify() fail-open
  // log warn, no mail real sent.
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = '1';

  // Lockout: soglie basse per test veloci.
  process.env.LOCKOUT_THRESHOLD = '3';
  process.env.LOCKOUT_WINDOW_MS = '60000';
  process.env.LOCKOUT_DURATION_MS = '5000';

  // Throttler: soglie alte per non interferire con gli scenari CRUD.
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
  // evolve. RESTART IDENTITY non rilevante (UUID v7 app-side). `aziende`
  // incluso (FK → tenants): truncato tra ogni test.
  await client.query(`
    TRUNCATE TABLE
      scadenze,
      scadenze_categorie,
      aziende,
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
     VALUES ($1, 'Studio Demo', 'studio-demo', true, NOW(), NOW());`,
    [tenantId],
  );

  await client.query(
    `INSERT INTO sedi (id, tenant_id, name, address, city, postal_code, country, timezone, currency, is_active, created_at, updated_at)
     VALUES ($1, $2, 'Sede Studio', 'Via Test 1', 'Milano', '20100', 'IT', 'Europe/Rome', 'EUR', true, NOW(), NOW());`,
    [sedeId, tenantId],
  );

  await client.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
     VALUES ($1, $2, 'admin@studio.local', $3, 'Admin', 'Studio', true, 0, NOW(), NOW());`,
    [adminUserId, tenantId, adminPasswordHash],
  );

  await client.end();
  return { tenantId, sedeId, adminUserId };
}

// =============================================================================
// seedSecondTenant — secondo tenant per l'isolamento cross-tenant
// =============================================================================
// Chiamare DOPO seedMinimal. Crea tenant 'studio-acme' + sede + admin.
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
  const email = opts.email ?? 'admin@studio-acme.local';

  await client.query(
    `INSERT INTO tenants (id, name, slug, is_active, created_at, updated_at)
     VALUES ($1, 'Studio Acme', 'studio-acme', true, NOW(), NOW());`,
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
