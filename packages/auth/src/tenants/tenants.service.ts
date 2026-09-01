// =============================================================================
// tenants.service.ts — Bootstrap di un nuovo tenant (D4)
// =============================================================================
// Operazione single-shot che crea tenant + sede + admin user + clone di TUTTI
// i system_role_templates con isDefault=true → roles tenant-scoped
// (+ role_permissions) + admin assignment Super Admin tenant-wide + audit log.
//
// Pattern: tutto dentro `withSystemContextAtomicTx` (D4 + atomicity fix
// emerso dal STEP 2a-bis). 8 operazioni in un singolo $transaction Prisma →
// rollback automatico se qualunque step throwa. Permission check FUORI dal
// tx (anti-pattern: guard dentro tx tiene aperto un connection lungo).
//
// Decisioni D4 (vedi ADR-0010):
// - withSystemContext (no tenantId disponibile pre-creazione)
// - Authorization via @RequirePermissions Guard decorator (RBAC sessione 11
//   ADR-0017). Inline check rimosso dal service — single source of truth nel
//   Guard con cache Redis TTL 60s + audit auth.permission_denied automatico.
// - 1 transaction atomic (orphan rows = bad UX su failure mid-flow)
// - System role templates letti dinamicamente (no hardcoding nomi)
// - Audit log con tenantId del nuovo tenant + action 'tenant.created'
// =============================================================================

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { id, prisma, withSystemContextAtomicTx } from '@gestionale/db';
import argon2 from 'argon2';

import type { CreateTenantDto } from './dto/create-tenant.dto';

export interface CreateTenantResult {
  tenant: { id: string; slug: string; name: string };
  sede: { id: string; name: string };
  admin: { id: string; email: string };
  superAdminRole: { id: string; name: string };
}

const SEDE_DEFAULT_NAME = 'Sede Principale';
const SEDE_DEFAULT_CITY = 'Milano';
const SEDE_DEFAULT_POSTAL_CODE = '20100';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  async createTenant(dto: CreateTenantDto, createdBy: string): Promise<CreateTenantResult> {
    // Authorization: gestita via @RequirePermissions('sistema.tenant.gestisci')
    // su TenantsController#create() (RBAC Guard sessione 11, ADR-0017).
    // Guard fa lazy lookup con cache Redis TTL 60s + audit
    // auth.permission_denied automatico su deny. Single source of truth.

    // -------------------------------------------------------------------------
    // 1. Defaults sede (service-side, DTO pulito)
    // -------------------------------------------------------------------------
    const sedeName = dto.sedeName ?? SEDE_DEFAULT_NAME;
    const sedeCity = dto.sedeCity ?? SEDE_DEFAULT_CITY;
    const sedePostalCode = dto.sedePostalCode ?? SEDE_DEFAULT_POSTAL_CODE;

    // -------------------------------------------------------------------------
    // 2. Atomic bootstrap (single $transaction, system context)
    // -------------------------------------------------------------------------
    return withSystemContextAtomicTx(prisma, async (tx) => {
      // 2.1 Slug uniqueness
      const existing = await tx.tenant.findUnique({ where: { slug: dto.slug } });
      if (existing) {
        throw new ConflictException({
          errorCode: 'E_TENANT_SLUG_EXISTS',
          message: `Tenant with slug '${dto.slug}' already exists`,
        });
      }

      // 2.2 Tenant (+ identità pubblica opzionale ADR-0049: undefined → null)
      const tenant = await tx.tenant.create({
        data: {
          id: id(),
          name: dto.name,
          slug: dto.slug,
          isActive: true,
          descrizione: dto.descrizione ?? null,
          indirizzo: dto.indirizzo ?? null,
          telefono: dto.telefono ?? null,
          emailContatto: dto.emailContatto ?? null,
          sitoWeb: dto.sitoWeb ?? null,
          logoUrl: dto.logoUrl ?? null,
        },
      });

      // 2.3 Sede
      const sede = await tx.sede.create({
        data: {
          id: id(),
          tenantId: tenant.id,
          name: sedeName,
          city: sedeCity,
          postalCode: sedePostalCode,
          // country/timezone/currency: defaults schema (IT / Europe/Rome / EUR)
        },
      });

      // 2.4 Hash admin password (argon2 e' CPU-bound, ma dentro tx non c'e'
      // problema: la connection del tx non e' tenuta a lungo da una query DB
      // attiva, solo allocata mentre la promise pending. Postgres tx attive
      // sono leggere se non bloccano lock).
      const passwordHash = await argon2.hash(dto.adminPassword, { type: argon2.argon2id });

      // 2.5 Admin user
      const admin = await tx.user.create({
        data: {
          id: id(),
          tenantId: tenant.id,
          email: dto.adminEmail,
          passwordHash,
          firstName: dto.adminFirstName,
          lastName: dto.adminLastName,
          isActive: true,
        },
      });

      // 2.6 Clone di TUTTI i system_role_templates con isDefault=true (oggi 7)
      // → roles tenant-scoped + copia mapping system_role_template_permissions
      // → role_permissions. Letti dinamicamente.
      // ✅ TD-bootstrap-verticale (ADR-0060) CHIUSO per costruzione: il debito era
      // che `isDefault` è globale e non per-verticale, quindi un tenant nato qui
      // riceveva anche i ruoli del verticale sbagliato. Con un verticale solo non
      // esiste più un verticale sbagliato: i 7 template sono tutti dello studio.
      // Se un secondo verticale tornasse, il debito torna con lui — la causa-radice
      // (nessuna dimensione `verticale` nei dati) non è stata risolta, è decaduta.
      const templates = await tx.systemRoleTemplate.findMany({
        where: { isDefault: true },
        include: { permissions: true },
      });

      const rolesByName = new Map<string, { id: string; name: string }>();
      for (const template of templates) {
        const newRole = await tx.role.create({
          data: {
            id: id(),
            tenantId: tenant.id,
            name: template.name,
            description: template.description,
            isSystem: true,
          },
        });

        // Permission mappings (1 per template.permissions[])
        for (const tp of template.permissions) {
          await tx.rolePermission.create({
            data: { roleId: newRole.id, permissionId: tp.permissionId },
          });
        }

        rolesByName.set(template.name, { id: newRole.id, name: newRole.name });
      }

      // 2.7 Assign admin → Super Admin tenant-wide (sede_id NULL)
      const superAdminRole = rolesByName.get('Super Admin');
      if (!superAdminRole) {
        // Invariante: system_role_templates seed garantisce 'Super Admin' con
        // isDefault=true. Se manca, qualcuno ha modificato il seed in modo
        // incompatibile.
        throw new Error(
          "System invariant violation: 'Super Admin' system_role_template missing or not default",
        );
      }
      await tx.userRole.create({
        data: {
          id: id(),
          userId: admin.id,
          roleId: superAdminRole.id,
          sedeId: null,
          assignedById: createdBy,
        },
      });

      // 2.8 Audit log: action 'tenant.created' (nuovo enum D4, totale 10 actions).
      // afterValue NON include adminPassword (security leak).
      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId: tenant.id,
          userId: createdBy,
          action: 'tenant.created',
          entityType: 'Tenant',
          entityId: tenant.id,
          afterValue: {
            slug: tenant.slug,
            name: tenant.name,
            adminEmail: dto.adminEmail,
          },
        },
      });

      this.logger.log(`Tenant bootstrap OK: ${tenant.slug} (${tenant.id}) by user ${createdBy}`);

      return {
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        sede: { id: sede.id, name: sede.name },
        admin: { id: admin.id, email: admin.email },
        superAdminRole,
      };
    });
  }
}
