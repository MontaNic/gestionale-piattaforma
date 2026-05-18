import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';

import { GlobalHttpExceptionFilter } from '../../common/filters/global-http-exception.filter';

// =============================================================================
// LockoutExceptionFilter — Retry-After: 900 fissi su E_AUTH_ACCOUNT_LOCKED
// =============================================================================
// (decisione lockata STOP 3, TD-J):
//
// Quando AuthService lancia HttpException(429) con body { errorCode:
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
// Inheritance: extends GlobalHttpExceptionFilter (TD-AY) per condividere la
// normalizzazione shape `{statusCode, errorCode, message}` via super.catch().
// LockoutExceptionFilter aggiunge SOLO il side-effect Retry-After header,
// poi delega la response al parent. Pre-TD-AY estendeva BaseExceptionFilter
// che emetteva la shape NestJS default — inconsistente con altri endpoint.
//
// Wire: APP_FILTER globale in AuthModule (DI priority sopra useGlobalFilters
// di main.ts). Funziona per QUALSIASI HttpException: se body.errorCode !==
// 'E_AUTH_ACCOUNT_LOCKED' → no Retry-After, ma normalize comunque applicata.
// =============================================================================
@Catch(HttpException)
export class LockoutExceptionFilter extends GlobalHttpExceptionFilter implements ExceptionFilter {
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
      'errorCode' in body &&
      (body as { errorCode: unknown }).errorCode === 'E_AUTH_ACCOUNT_LOCKED'
    );
  }
}
