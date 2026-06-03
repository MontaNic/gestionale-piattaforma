// =============================================================================
// jwt.strategy.ts — Passport JWT strategy con stateful session lookup
// =============================================================================
// Per ogni request autenticato: decoda JWT, verifica session attiva in DB,
// carica user. Costo: 1-2 query Prisma per request. F1 acceptable, ADR-0008
// tech debt per Redis cache TTL=30s.
//
// D3b RLS: JwtStrategy.validate() fires al guard stage (PRIMA del
// TenantContextInterceptor che setta ALS al controller stage). Senza wrap
// esplicito, le query Prisma qui dentro lanciano RlsNoContextError. Soluzione:
// wrap del body in `runInTenantContext(payload.tenantId, false)`. Defense in
// depth: RLS filtra session.findUnique sul tenantId del JWT, quindi un
// attaccante che forge JWT con tenantId diverso vede 0 sessions -> 401.
// =============================================================================

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { runInTenantContext } from '@gestionale/db';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { DbService } from '../../db/db.service';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../interfaces/authenticated-request.interface';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthErrorCode } from '@gestionale/shared';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET env var required (apps/api auth module)');
  }
  return secret;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(DbService) private readonly db: DbService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
      passReqToCallback: true,
    });
  }

  async validate(req: AuthenticatedRequest, payload: JwtPayload): Promise<AuthenticatedUser> {
    // Solo access token possono autenticare richieste API. Refresh sono
    // accettati solo da AuthController.refresh() che li verifica manualmente.
    if (payload.type !== 'access') {
      throw new UnauthorizedException('E_AUTH_INVALID_TOKEN_TYPE');
    }

    // RLS context wrap: JwtStrategy fires al guard stage (prima dell'Interceptor
    // globale). Le query Prisma qui dentro hanno bisogno di ALS context, sennò
    // RlsNoContextError. Wrap su payload.tenantId con isSuperAdmin:false ->
    // defense in depth (vedi header del file).
    return runInTenantContext({ tenantId: payload.tenantId, isSuperAdmin: false }, () =>
      this.validateInContext(req, payload),
    );
  }

  /**
   * Body della validate(), gira sempre dentro ALS tenant context (vedi sopra).
   * Estratto come metodo privato per leggibilita'.
   */
  private async validateInContext(
    req: AuthenticatedRequest,
    payload: JwtPayload,
  ): Promise<AuthenticatedUser> {
    const session = await this.db.prisma.session.findUnique({
      where: { id: payload.sessionId },
    });

    if (
      !session ||
      !session.isActive ||
      session.expiresAt < new Date() ||
      session.userId !== payload.sub
    ) {
      throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    }

    const user = await this.db.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || user.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('E_AUTH_USER_INVALID');
    }

    // Update last_seen_at su ogni request (cheap, best-effort)
    void this.db.prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {
        /* silent: lastSeenAt e' best-effort, non blocchiamo auth */
      });

    // Attacca info utili al request per uso downstream (es. CurrentTenant)
    req.sessionId = session.id;
    req.tenantId = user.tenantId;

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
    };
    return authenticatedUser; // Passport mette automaticamente su req.user
  }
}
