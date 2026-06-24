// =============================================================================
// inviti.service.ts — onboarding clienti al portale (feat/invito-cliente)
// =============================================================================
// Token sha256 (no plaintext in DB, parità con PasswordReset), TTL 7gg, monouso.
// - creaInvito: upsert su (tenant, azienda, email) → dedup + rinnova (nuovo
//   token/scadenza). Invia email con link tenant-scoped.
// - accettaInvito: valida token, crea User tipo=cliente, auto-promote admin se
//   l'azienda non ha ancora un admin attivo, assegna ruolo "Cliente", logga il
//   nuovo utente (issueSessionForUser → AuthTokensPayload).
// - listInviti / revocaInvito: gestione pannello operatore (revoca = usedAt,
//   niente .delete() per l'estensione soft-delete ADR-0021).
//
// RLS: i metodi girano nel context ALS del tenant (TenantContextInterceptor su
// rotte operatore via JWT, TenantMiddleware su accept-invite @Public).
// =============================================================================

import crypto from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import { ClienteRuolo, id } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { AuthService, type AuthTokensPayload } from '@gestionale/auth';
import { catchUniqueViolation, MailService } from '@gestionale/platform';

import type { CreateInvitoDto } from './dto/create-invito.dto';
import type { AcceptInviteDto } from './dto/accept-invite.dto';

const INVITO_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 giorni
const MIN_PASSWORD_LENGTH = 8;

export interface InvitoView {
  id: string;
  email: string;
  clienteRuolo: ClienteRuolo;
  expiresAt: Date;
  createdAt: Date;
  invitatoDa: { firstName: string; lastName: string };
}

@Injectable()
export class InvitiService {
  private readonly logger = new Logger(InvitiService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // CREA INVITO — upsert (dedup + rinnova) + invio email
  // ---------------------------------------------------------------------------
  async creaInvito(
    tenantId: string,
    aziendaId: string,
    invitatoDa: { id: string; firstName: string; lastName: string },
    dto: CreateInvitoDto,
  ): Promise<InvitoView> {
    const azienda = await this.db.prisma.azienda.findFirst({
      where: { id: aziendaId, tenantId },
    });
    if (!azienda) {
      throw new NotFoundException({
        errorCode: 'E_AZIENDA_NOT_FOUND',
        message: 'Azienda not found',
      });
    }

    // Slug del tenant per il link FE tenant-scoped. Leggibile sotto RLS (la
    // policy tenants espone la riga con id = current tenant). Pre-auth lo dava
    // il middleware; qui (post-auth operatore) lo risolviamo dal tenantId JWT.
    const tenant = await this.db.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    if (!tenant) {
      throw new NotFoundException({
        errorCode: 'E_AZIENDA_NOT_FOUND',
        message: 'Tenant not found',
      });
    }
    const tenantSlug = tenant.slug;

    const ruolo = dto.clienteRuolo ?? ClienteRuolo.utente;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + INVITO_TTL_SECONDS * 1000);

    // Dedup naturale (tenant, azienda, email): upsert → un invito pendente per
    // coppia, il re-invito rinnova token + scadenza e azzera usedAt.
    const invito = await this.db.prisma.clienteInvito.upsert({
      where: {
        tenantId_aziendaId_email: { tenantId, aziendaId, email: dto.email },
      },
      create: {
        id: id(),
        tenantId,
        aziendaId,
        email: dto.email,
        clienteRuolo: ruolo,
        tokenHash,
        expiresAt,
        invitatoDaId: invitatoDa.id,
      },
      update: {
        clienteRuolo: ruolo,
        tokenHash,
        expiresAt,
        usedAt: null,
        invitatoDaId: invitatoDa.id,
      },
    });

    const inviteLink = `${this.inviteUrlBase()}/t/${tenantSlug}/accept-invite?token=${token}`;
    const emailSent = await this.mail.sendInvitoClienteEmail({
      to: dto.email,
      inviteLink,
      aziendaNome: azienda.nome,
      invitatoDaNome: `${invitatoDa.firstName} ${invitatoDa.lastName}`.trim(),
    });
    this.logger.log(
      `Invito cliente upsert: azienda=${aziendaId} email=${dto.email} emailSent=${emailSent} tenant=${tenantId}`,
    );

    return {
      id: invito.id,
      email: invito.email,
      clienteRuolo: invito.clienteRuolo,
      expiresAt: invito.expiresAt,
      createdAt: invito.createdAt,
      invitatoDa: { firstName: invitatoDa.firstName, lastName: invitatoDa.lastName },
    };
  }

  // ---------------------------------------------------------------------------
  // LIST INVITI — pendenti (usedAt null) di un'azienda
  // ---------------------------------------------------------------------------
  async listInviti(tenantId: string, aziendaId: string): Promise<InvitoView[]> {
    const azienda = await this.db.prisma.azienda.findFirst({
      where: { id: aziendaId, tenantId },
    });
    if (!azienda) {
      throw new NotFoundException({
        errorCode: 'E_AZIENDA_NOT_FOUND',
        message: 'Azienda not found',
      });
    }

    const inviti = await this.db.prisma.clienteInvito.findMany({
      where: { tenantId, aziendaId, usedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      include: { invitatoDa: { select: { firstName: true, lastName: true } } },
    });

    return inviti.map((i) => ({
      id: i.id,
      email: i.email,
      clienteRuolo: i.clienteRuolo,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      invitatoDa: { firstName: i.invitatoDa.firstName, lastName: i.invitatoDa.lastName },
    }));
  }

  // ---------------------------------------------------------------------------
  // REVOCA INVITO — marca usedAt (token non più valido, sparisce dai pendenti)
  // ---------------------------------------------------------------------------
  async revocaInvito(
    tenantId: string,
    aziendaId: string,
    invitoId: string,
  ): Promise<{ id: string; revoked: true }> {
    const invito = await this.db.prisma.clienteInvito.findFirst({
      where: { id: invitoId, tenantId, aziendaId, usedAt: null },
    });
    if (!invito) {
      throw new NotFoundException({ errorCode: 'E_INVITO_NOT_FOUND', message: 'Invito not found' });
    }

    await this.db.prisma.clienteInvito.update({
      where: { id: invitoId },
      data: { usedAt: new Date() },
    });
    this.logger.log(`Invito revocato: ${invitoId} azienda=${aziendaId} tenant=${tenantId}`);
    return { id: invitoId, revoked: true };
  }

  // ---------------------------------------------------------------------------
  // ACCETTA INVITO — crea User cliente + auto-promote + ruolo + login
  // ---------------------------------------------------------------------------
  async accettaInvito(
    tenantId: string,
    dto: AcceptInviteDto,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokensPayload> {
    // Ri-validazione lunghezza password server-side (ValidationPipe inattiva in E2E).
    if (typeof dto.password !== 'string' || dto.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException({
        errorCode: 'E_AUTH_PASSWORD_TOO_SHORT',
        message: 'Password too short',
      });
    }

    const tokenHash = this.hashToken(dto.token);
    const invito = await this.db.prisma.clienteInvito.findFirst({
      where: { tokenHash, tenantId },
    });
    if (!invito || invito.usedAt) {
      throw new BadRequestException({
        errorCode: 'E_INVITO_TOKEN_INVALID',
        message: 'Invite token invalid',
      });
    }
    if (invito.expiresAt < new Date()) {
      throw new BadRequestException({
        errorCode: 'E_INVITO_TOKEN_EXPIRED',
        message: 'Invite token expired',
      });
    }

    // Collisione email: esiste già un utente (attivo) con questa email nel tenant.
    const existing = await this.db.prisma.user.findFirst({
      where: { tenantId, email: invito.email },
    });
    if (existing) {
      throw new ConflictException({
        errorCode: 'E_INVITO_EMAIL_EXISTS',
        message: 'A user with this email already exists',
      });
    }

    // Auto-promote: se l'invito è 'utente' ma l'azienda non ha ancora un cliente
    // admin attivo, il primo che accetta diventa admin (legacy StudioDesk).
    let ruolo = invito.clienteRuolo;
    if (ruolo !== ClienteRuolo.admin) {
      const adminEsistente = await this.db.prisma.user.findFirst({
        where: {
          tenantId,
          aziendaId: invito.aziendaId,
          tipo: 'cliente',
          clienteRuolo: ClienteRuolo.admin,
          isActive: true,
        },
      });
      if (!adminEsistente) ruolo = ClienteRuolo.admin;
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const userId = id();

    // Ruolo RBAC "Cliente" del tenant (permessi portale.*). Risolto fuori dalla
    // tx; se assente (tenant non bootstrappato) si logga e si prosegue: l'utente
    // viene creato comunque, l'admin potrà assegnare il ruolo a posteriori.
    const clienteRole = await this.db.prisma.role.findFirst({
      where: { tenantId, name: 'Cliente' },
    });

    await catchUniqueViolation(
      () =>
        this.db.prisma.$transaction(async (tx) => {
          await tx.user.create({
            data: {
              id: userId,
              tenantId,
              email: invito.email,
              passwordHash,
              firstName: dto.firstName,
              lastName: dto.lastName,
              tipo: 'cliente',
              aziendaId: invito.aziendaId,
              clienteRuolo: ruolo,
              emailVerifiedAt: new Date(), // verificata via link email
              isActive: true,
            },
          });
          await tx.clienteInvito.update({
            where: { id: invito.id },
            data: { usedAt: new Date() },
          });
          if (clienteRole) {
            await tx.userRole.create({
              data: { id: id(), userId, roleId: clienteRole.id, sedeId: null },
            });
          }
        }),
      'E_INVITO_EMAIL_EXISTS',
    );

    if (!clienteRole) {
      this.logger.warn(
        `Ruolo 'Cliente' assente per tenant=${tenantId}: utente ${userId} creato senza ruolo portale.`,
      );
    }
    this.logger.log(
      `Invito accettato: user=${userId} azienda=${invito.aziendaId} ruolo=${ruolo} tenant=${tenantId}`,
    );

    // Login pulito: emette tokens + sessione per il nuovo cliente.
    return this.auth.issueSessionForUser(userId, tenantId, meta);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** sha256 hex del token: in DB sta solo l'hash, mai il plaintext. */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** Base URL FE per il link invito (env dedicato → CORS_ORIGIN → default dev). */
  private inviteUrlBase(): string {
    const base =
      this.config.get<string>('INVITO_URL_BASE') ??
      this.config.get<string>('CORS_ORIGIN') ??
      'http://localhost:3003';
    return base.replace(/\/+$/, '');
  }
}
