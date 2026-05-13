import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// =============================================================================
// LockoutExceptionFilter — Retry-After: 900 fissi su E_AUTH_ACCOUNT_LOCKED
// =============================================================================
// (decisione lockata STOP 3, TD-J):
//
// Quando AuthService lancia HttpException(429) con body { code:
// 'E_AUTH_ACCOUNT_LOCKED', ... }, questo filter intercetta PRIMA del default
// NestJS handler e setta `Retry-After: 900` (15 min) sull'header response.
//
// Perche' 900 FISSI e non il retryAfterSec reale dalla checkLockout?
// Anti user-enumeration: un attacker che osserva `Retry-After` decrescente
// puo' triangolare quando l'account e' stato bloccato per primo tentativo,
// potenzialmente inferendo che l'email/deviceId esiste. Valore costante
// elimina questa side-channel.
//
// Trade-off documentato in ADR-0013 TD-J.
//
// Inheritance: extends BaseExceptionFilter per delegare il rendering del body
// JSON al default NestJS handler (super.catch). Niente duplicazione del
// format response standard (`{statusCode, message, error, code, ...}`).
//
// Wire: APP_FILTER globale in AuthModule. Funziona per QUALSIASI HttpException
// (non solo lockout): se body.code !== 'E_AUTH_ACCOUNT_LOCKED' → pass-through
// puro al default handler.
// =============================================================================
@Catch(HttpException)
export class LockoutExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  // Niente constructor: BaseExceptionFilter risolve HttpAdapterHost via DI
  // quando registrato come APP_FILTER. Custom constructor con arg opzionale
  // confonde il DI ("UnknownDependenciesException").
  override catch(exception: HttpException, host: ArgumentsHost): void {
    const body = exception.getResponse();
    if (this.isLockoutResponse(body)) {
      const response = host.switchToHttp().getResponse<{
        setHeader: (name: string, value: string) => void;
      }>();
      response.setHeader('Retry-After', '900');
    }
    super.catch(exception, host);
  }

  private isLockoutResponse(body: unknown): boolean {
    return (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      (body as { code: unknown }).code === 'E_AUTH_ACCOUNT_LOCKED'
    );
  }
}
