// =============================================================================
// create-tenant.dto.ts — Body validation per POST /api/v1/tenants
// =============================================================================
// Bootstrap nuovo tenant (D4): name + slug + admin user iniziale + sede di
// default. Defaults sede applicati lato service (`TenantsService.createTenant`)
// quando i campi optional sono undefined: DTO pulito + single source of truth.
//
// Slug regex: `^[a-z][a-z0-9-]{2,49}$` — minuscole iniziali, alfanumerico +
// dash, no underscore, no spazi, no maiuscole. Min 3, max 50 char. Riservati
// in FORBIDDEN_SLUGS.
//
// Error codes (uppercase E_*): coerenti con pattern auth/* (ADR-0008).
// =============================================================================

import {
  IsEmail,
  IsNotIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { FORBIDDEN_SLUGS } from './forbidden-slugs';

export class CreateTenantDto {
  // ---------------------------------------------------------------------------
  // Tenant
  // ---------------------------------------------------------------------------

  @IsString()
  @MinLength(3, { message: 'E_TENANT_NAME_TOO_SHORT' })
  @MaxLength(100, { message: 'E_TENANT_NAME_TOO_LONG' })
  name!: string;

  /**
   * Slug univoco tenant, usato in `X-Tenant-Slug` header pre-auth.
   * Pattern: lowercase iniziale, alfanumerico + dash, 3-50 char.
   * Riservato: vedi FORBIDDEN_SLUGS (anti-collision route).
   */
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{2,49}$/, { message: 'E_TENANT_SLUG_INVALID_FORMAT' })
  // class-validator IsNotIn fa exact-match case-sensitive — il regex sopra
  // gia' garantisce input lowercase, quindi questo check copre i casi `admin`,
  // `api`, etc. esattamente come arriverebbero al server.
  @IsNotIn(FORBIDDEN_SLUGS as string[], { message: 'E_TENANT_SLUG_RESERVED' })
  slug!: string;

  // ---------------------------------------------------------------------------
  // Admin user iniziale (bootstrap del tenant)
  // ---------------------------------------------------------------------------

  @IsEmail({}, { message: 'E_AUTH_EMAIL_INVALID' })
  adminEmail!: string;

  @IsString()
  @MinLength(8, { message: 'E_AUTH_PASSWORD_TOO_SHORT' })
  adminPassword!: string;

  @IsString()
  @MinLength(1, { message: 'E_AUTH_FIRST_NAME_REQUIRED' })
  @MaxLength(50, { message: 'E_AUTH_FIRST_NAME_TOO_LONG' })
  adminFirstName!: string;

  @IsString()
  @MinLength(1, { message: 'E_AUTH_LAST_NAME_REQUIRED' })
  @MaxLength(50, { message: 'E_AUTH_LAST_NAME_TOO_LONG' })
  adminLastName!: string;

  // ---------------------------------------------------------------------------
  // Sede di default (opzionale: default applicati in TenantsService)
  // ---------------------------------------------------------------------------

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'E_SEDE_NAME_REQUIRED' })
  @MaxLength(100, { message: 'E_SEDE_NAME_TOO_LONG' })
  sedeName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'E_SEDE_CITY_REQUIRED' })
  @MaxLength(50, { message: 'E_SEDE_CITY_TOO_LONG' })
  sedeCity?: string;

  /**
   * CAP italiano (5 cifre). Validato solo se valorizzato dal client.
   * Default '20100' applicato in service quando undefined.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/, { message: 'E_SEDE_POSTAL_CODE_INVALID' })
  sedePostalCode?: string;

  // ---------------------------------------------------------------------------
  // Identità pubblica dello studio (opzionale, ADR-0049)
  // ---------------------------------------------------------------------------
  // Campi mostrati sulla landing pubblica /t/<slug> (GET /public/tenants/:slug).
  // Nullable in schema: undefined → null in TenantsService.createTenant.

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'E_TENANT_DESCRIZIONE_TOO_LONG' })
  descrizione?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'E_TENANT_INDIRIZZO_TOO_LONG' })
  indirizzo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'E_TENANT_TELEFONO_TOO_LONG' })
  telefono?: string;

  @IsOptional()
  @IsEmail({}, { message: 'E_TENANT_EMAIL_CONTATTO_INVALID' })
  emailContatto?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'E_TENANT_SITO_WEB_INVALID' })
  sitoWeb?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'E_TENANT_LOGO_URL_INVALID' })
  logoUrl?: string;
}
