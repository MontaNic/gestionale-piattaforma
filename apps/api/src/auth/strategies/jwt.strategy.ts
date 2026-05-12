// =============================================================================
// jwt.strategy.ts — Passport JWT strategy con stateful session lookup
// =============================================================================
// Per ogni request autenticato: decoda JWT, verifica session attiva in DB,
// carica user. Costo: 1-2 query Prisma per request. F1 acceptable, ADR-0008
// tech debt per Redis cache TTL=30s.
// =============================================================================

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { DbService } from '../../db/db.service';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../interfaces/authenticated-request.interface';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET env var required (apps/api auth module)');
  }
  return secret;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly db: DbService) {
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

    const session = await this.db.prisma.session.findUnique({
      where: { id: payload.sessionId },
    });

    if (
      !session ||
      !session.isActive ||
      session.expiresAt < new Date() ||
      session.userId !== payload.sub
    ) {
      throw new UnauthorizedException('E_AUTH_SESSION_INVALID');
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
