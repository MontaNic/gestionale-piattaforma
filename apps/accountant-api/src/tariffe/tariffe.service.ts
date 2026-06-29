// =============================================================================
// tariffe.service.ts — Tariffario orario (ADR-0055, Onda 4 Task 3b)
// =============================================================================
// Listino COSTI orari per ruolo (default) o utente (override). RLS FORCE
// (tenant context da interceptor) + filtro tenantId esplicito (belt-and-
// suspenders, pattern mandati). Soft-delete (mai .delete()).
//
// Scope esclusivo (roleId XOR userId): validato qui (E_TARIFFA_SCOPE_INVALID) e
// a livello DB (CHECK). Partial-unique soft-delete-aware → al PIÙ una tariffa
// attiva per ruolo / per utente (E_TARIFFA_DUPLICATA su violazione).
//
// resolveTariffaOraria(): risoluzione usata da PrestazioniService per derivare
// Prestazione.importo. Precedenza: override-utente → tariffa-ruolo (la PIÙ ALTA
// tra i ruoli dell'utente, tie-break confermato) → null (nessuna tariffa).
// =============================================================================

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type TariffaOraria, id } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { catchUniqueViolation } from '@gestionale/platform';

import type { CreateTariffaDto } from './dto/create-tariffa.dto';
import type { UpdateTariffaDto } from './dto/update-tariffa.dto';

export interface TariffaRow extends TariffaOraria {
  roleName: string | null;
  userName: string | null;
}

@Injectable()
export class TariffeService {
  private readonly logger = new Logger(TariffeService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async create(tenantId: string, dto: CreateTariffaDto): Promise<TariffaOraria> {
    // 1. Scope XOR: esattamente uno tra roleId / userId.
    const hasRole = !!dto.roleId;
    const hasUser = !!dto.userId;
    if (hasRole === hasUser) {
      throw new BadRequestException({
        errorCode: 'E_TARIFFA_SCOPE_INVALID',
        message: 'Esattamente uno tra roleId e userId deve essere valorizzato',
      });
    }

    // 2. Il target (ruolo o utente) dev'essere in-scope (non cancellato).
    if (dto.roleId) {
      const role = await this.db.prisma.role.findFirst({
        where: { id: dto.roleId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!role) {
        throw new BadRequestException({
          errorCode: 'E_TARIFFA_ROLE_NOT_FOUND',
          message: 'Role not found',
        });
      }
    } else {
      const user = await this.db.prisma.user.findFirst({
        where: { id: dto.userId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!user) {
        throw new BadRequestException({
          errorCode: 'E_TARIFFA_USER_NOT_FOUND',
          message: 'User not found',
        });
      }
    }

    // 3. Create (partial-unique → E_TARIFFA_DUPLICATA se esiste già attiva).
    const tariffa = await catchUniqueViolation(
      () =>
        this.db.prisma.tariffaOraria.create({
          data: {
            id: id(),
            tenantId,
            roleId: dto.roleId ?? null,
            userId: dto.userId ?? null,
            tariffaOraria: dto.tariffaOraria,
            note: dto.note ?? null,
          },
        }),
      'E_TARIFFA_DUPLICATA',
    );
    this.logger.log(
      `Tariffa created: ${tariffa.id} ${dto.roleId ? `role=${dto.roleId}` : `user=${dto.userId}`} tenant=${tenantId}`,
    );
    return tariffa;
  }

  async list(tenantId: string): Promise<TariffaRow[]> {
    const rows = await this.db.prisma.tariffaOraria.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        role: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map(({ role, user, ...t }) => ({
      ...t,
      roleName: role?.name ?? null,
      userName: user ? `${user.firstName} ${user.lastName}` : null,
    }));
  }

  async findOne(tenantId: string, tariffaId: string): Promise<TariffaOraria> {
    const tariffa = await this.db.prisma.tariffaOraria.findFirst({
      where: { id: tariffaId, tenantId, deletedAt: null },
    });
    if (!tariffa) {
      throw new NotFoundException({
        errorCode: 'E_TARIFFA_NOT_FOUND',
        message: 'Tariffa not found',
      });
    }
    return tariffa;
  }

  async update(tenantId: string, tariffaId: string, dto: UpdateTariffaDto): Promise<TariffaOraria> {
    await this.findOne(tenantId, tariffaId); // ownership + 404
    const updated = await this.db.prisma.tariffaOraria.update({
      where: { id: tariffaId },
      data: {
        tariffaOraria: dto.tariffaOraria,
        attivo: dto.attivo,
        note: dto.note,
      },
    });
    this.logger.log(`Tariffa updated: ${tariffaId} tenant=${tenantId}`);
    return updated;
  }

  async softDelete(tenantId: string, tariffaId: string): Promise<{ id: string; deleted: true }> {
    await this.findOne(tenantId, tariffaId); // ownership + 404
    // Soft-delete (ADR-0021): mai .delete(). Il partial-unique è WHERE deleted_at
    // IS NULL → dopo il soft-delete si può ridefinire la tariffa per lo stesso target.
    await this.db.prisma.tariffaOraria.update({
      where: { id: tariffaId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Tariffa soft-deleted: ${tariffaId} tenant=${tenantId}`);
    return { id: tariffaId, deleted: true };
  }

  // ── Lookup per i picker del form (scope ruolo/utente) ──────────────────────

  /** Ruoli del tenant (non cancellati) per il picker scope=ruolo. */
  async listRoles(tenantId: string): Promise<Array<{ id: string; name: string }>> {
    return this.db.prisma.role.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Utenti operatore attivi del tenant per il picker scope=utente (no portale). */
  async listUsers(tenantId: string): Promise<Array<{ id: string; name: string }>> {
    const users = await this.db.prisma.user.findMany({
      where: { tenantId, tipo: 'operatore', isActive: true, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` }));
  }

  // ── Risoluzione tariffa per la derivazione importo ─────────────────────────

  /**
   * Risolve il costo orario applicabile all'autore di una prestazione.
   * Precedenza: (1) override per-utente attivo; (2) tariffa-ruolo attiva — se
   * l'utente ha più ruoli con tariffa, la PIÙ ALTA (tie-break confermato);
   * (3) null se nessuna tariffa è risolvibile. Restituisce un number (Decimal
   * normalizzato) o null. Chiamata sotto tenant context (RLS attiva).
   */
  async resolveTariffaOraria(tenantId: string, userId: string): Promise<number | null> {
    // 1. Override per-utente.
    const perUtente = await this.db.prisma.tariffaOraria.findFirst({
      where: { tenantId, userId, deletedAt: null, attivo: true },
      select: { tariffaOraria: true },
    });
    if (perUtente) return Number(perUtente.tariffaOraria);

    // 2. Tariffe dei ruoli dell'utente (user_roles raggiungibile via RLS join su roles).
    const userRoles = await this.db.prisma.userRole.findMany({
      where: { userId },
      select: { roleId: true },
    });
    if (userRoles.length === 0) return null;
    const roleIds = userRoles.map((r) => r.roleId);

    const perRuolo = await this.db.prisma.tariffaOraria.findMany({
      where: { tenantId, roleId: { in: roleIds }, deletedAt: null, attivo: true },
      select: { tariffaOraria: true },
    });
    if (perRuolo.length === 0) return null;

    const max = Math.max(...perRuolo.map((t) => Number(t.tariffaOraria)));
    if (perRuolo.length > 1) {
      this.logger.warn(
        `resolveTariffaOraria: utente ${userId} ha ${perRuolo.length} tariffe-ruolo attive → scelta la più alta (${max}) tenant=${tenantId}`,
      );
    }
    return max;
  }
}
