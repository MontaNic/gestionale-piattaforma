// =============================================================================
// tenants.service.ts — Bootstrap di un nuovo tenant (D4)
// =============================================================================
// Operazione single-shot che crea tenant + sede + admin user + clone dei 6
// system_role_templates → roles tenant-scoped (+ role_permissions) + admin
// assignment Super Admin tenant-wide + audit log.
//
// Pattern: tutto dentro `withSystemContextAtomicTx` (D4 + atomicity fix
// emerso dal STEP 2a-bis). 8 operazioni in un singolo $transaction Prisma →
// rollback automatico se qualunque step throwa. Permission check FUORI dal
// tx (anti-pattern: guard dentro tx tiene aperto un connection lungo).
//
// Decisioni D4 (vedi ADR-0010):
// - withSystemContext (no tenantId disponibile pre-creazione)
// - Inline permission check via UsersService.hasPermission (no Guard generico)
// - 1 transaction atomic (orphan rows = bad UX su failure mid-flow)
// - System role templates letti dinamicamente (no hardcoding nomi)
// - Audit log con tenantId del nuovo tenant + action 'tenant.created'
// =============================================================================

import { ConflictException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { id, withSystemContextAtomicTx } from '@gestionale/db';
import argon2 from 'argon2';

import { DbService } from '../db/db.service';
import { UsersService } from '../users/users.service';
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

const TENANT_BOOTSTRAP_PERMISSION = 'sistema.tenant.gestisci';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(UsersService) private readonly usersService: UsersService,
  ) {}

  async createTenant(dto: CreateTenantDto, createdBy: string): Promise<CreateTenantResult> {
    // -------------------------------------------------------------------------
    // 1. Permission check (FUORI dalla transaction)
    // -------------------------------------------------------------------------
    // Anti-pattern: permission check dentro tx tiene un'idle connection del pool
    // mentre fa una query di authorization. La guardia di entrata e' la prima
    // cosa: throw 403 prima di consumare risorse DB.
    const allowed = await this.usersService.hasPermission(createdBy, TENANT_BOOTSTRAP_PERMISSION);
    if (!allowed) {
      throw new ForbiddenException({
        errorCode: 'E_AUTH_INSUFFICIENT_PERMISSIONS',
        message: `${TENANT_BOOTSTRAP_PERMISSION} required`,
      });
    }

    // -------------------------------------------------------------------------
    // 2. Defaults sede (service-side, DTO pulito)
    // -------------------------------------------------------------------------
    const sedeName = dto.sedeName ?? SEDE_DEFAULT_NAME;
    const sedeCity = dto.sedeCity ?? SEDE_DEFAULT_CITY;
    const sedePostalCode = dto.sedePostalCode ?? SEDE_DEFAULT_POSTAL_CODE;

    // -------------------------------------------------------------------------
    // 3. Atomic bootstrap (single $transaction, system context)
    // -------------------------------------------------------------------------
    return withSystemContextAtomicTx(this.db.prisma, async (tx) => {
      // 3.1 Slug uniqueness
      const existing = await tx.tenant.findUnique({ where: { slug: dto.slug } });
      if (existing) {
        throw new ConflictException({
          errorCode: 'E_TENANT_SLUG_EXISTS',
          message: `Tenant with slug '${dto.slug}' already exists`,
        });
      }

      // 3.2 Tenant
      const tenant = await tx.tenant.create({
        data: { id: id(), name: dto.name, slug: dto.slug, isActive: true },
      });

      // 3.3 Sede
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

      // 3.4 Hash admin password (argon2 e' CPU-bound, ma dentro tx non c'e'
      // problema: la connection del tx non e' tenuta a lungo da una query DB
      // attiva, solo allocata mentre la promise pending. Postgres tx attive
      // sono leggere se non bloccano lock).
      const passwordHash = await argon2.hash(dto.adminPassword, { type: argon2.argon2id });

      // 3.5 Admin user
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

      // 3.6 Clone 6 system_role_templates (isDefault=true) → roles tenant-scoped
      // + copia mapping system_role_template_permissions → role_permissions.
      // Letti dinamicamente: se in futuro aggiungiamo template, scale-up free.
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

      // 3.7 Assign admin → Super Admin tenant-wide (sede_id NULL)
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

      // 3.8 Audit log: action 'tenant.created' (nuovo enum D4, totale 10 actions).
      // afterValue NON include adminPassword (security leak).
      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId: tenant.id,
          userId: createdBy,
          action: 'tenant.created',
          entityType: 'tenant',
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
