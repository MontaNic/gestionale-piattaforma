import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

// =============================================================================
// GlobalHttpExceptionFilter — normalizza shape errore HTTP cross-endpoint (TD-AY)
// =============================================================================
// Output shape unificato:
//   { statusCode: number, errorCode: string, message: string | string[], ...extras }
//
// `extras` preserva campi custom dei DTO (es. `timestamp` di AuthErrorResponse,
// futuri `retryAfter`, ecc.) escludendo i field normalizzati (`code`, `error`,
// `statusCode`, `errorCode`, `message`).
//
// Rules di estrazione errorCode (in ordine di precedenza):
//   1. body.errorCode string → preserva (DTO AuthErrorResponse esistente).
//   2. body.code string taxonomy (legacy lockout) → mappa a errorCode.
//   3. body.message string taxonomy (pattern `new UnauthorizedException('E_FOO')`,
//      NestJS wrappa in body.message) → string è errorCode; message rimpiazzata
//      dal default human-readable per lo status.
//   4. status 400 + body.message string[] (ValidationPipe class-validator) →
//      errorCode 'E_VALIDATION'; message preservata come array.
//   5. raw è string taxonomy (custom HttpException con string raw) → errorCode.
//   6. Fallback: errorCode derivato dallo status (E_UNAUTHORIZED, E_FORBIDDEN, …).
//
// LockoutExceptionFilter extends questa classe: super.catch() normalizza body
// dopo che il filter setta Retry-After (preserva inheritance, single normalization).
// =============================================================================
@Catch(HttpException)
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  private static readonly DEFAULT_MESSAGES: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'Validation failed',
    [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
    [HttpStatus.FORBIDDEN]: 'Forbidden',
    [HttpStatus.NOT_FOUND]: 'Not Found',
    [HttpStatus.CONFLICT]: 'Conflict',
    [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
    [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  };

  private static readonly STATUS_TO_DEFAULT_ERRORCODE: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'E_VALIDATION',
    [HttpStatus.UNAUTHORIZED]: 'E_UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'E_FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'E_NOT_FOUND',
    [HttpStatus.CONFLICT]: 'E_CONFLICT',
    [HttpStatus.TOO_MANY_REQUESTS]: 'E_RATE_LIMITED',
    [HttpStatus.INTERNAL_SERVER_ERROR]: 'E_INTERNAL',
  };

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const raw = exception.getResponse();

    const { errorCode, message, extras } = this.normalize(status, raw);

    if (status >= 500) {
      this.logger.error(`${status} ${errorCode}: ${JSON.stringify(message)}`, exception.stack);
    }

    response.status(status).json({
      ...extras,
      statusCode: status,
      errorCode,
      message,
    });
  }

  private normalize(
    status: number,
    raw: string | object,
  ): {
    errorCode: string;
    message: string | string[];
    extras: Record<string, unknown>;
  } {
    const defaultMessage = GlobalHttpExceptionFilter.DEFAULT_MESSAGES[status] ?? 'Error';
    const defaultErrorCode =
      GlobalHttpExceptionFilter.STATUS_TO_DEFAULT_ERRORCODE[status] ?? 'E_INTERNAL';

    if (typeof raw === 'string') {
      return {
        errorCode: this.isTaxonomyCode(raw) ? raw : defaultErrorCode,
        message: defaultMessage,
        extras: {},
      };
    }

    if (typeof raw === 'object' && raw !== null) {
      const body = raw as Record<string, unknown>;
      const extras = this.extractExtras(body);

      if (typeof body.errorCode === 'string') {
        return {
          errorCode: body.errorCode,
          message: this.extractMessage(body.message, defaultMessage),
          extras,
        };
      }

      if (typeof body.code === 'string' && this.isTaxonomyCode(body.code)) {
        return {
          errorCode: body.code,
          message: this.extractMessage(body.message, defaultMessage),
          extras,
        };
      }

      // NestJS pattern: `new UnauthorizedException('E_AUTH_FOO')` → body =
      // {statusCode, message: 'E_AUTH_FOO', error: 'Unauthorized'}. Detect
      // taxonomy code in `message` e promuovi a errorCode (legacy TD-AY scope).
      if (typeof body.message === 'string' && this.isTaxonomyCode(body.message)) {
        return {
          errorCode: body.message,
          message: defaultMessage,
          extras,
        };
      }

      if (status === HttpStatus.BAD_REQUEST && Array.isArray(body.message)) {
        return {
          errorCode: 'E_VALIDATION',
          message: body.message as string[],
          extras,
        };
      }

      return {
        errorCode: defaultErrorCode,
        message: this.extractMessage(body.message, defaultMessage),
        extras,
      };
    }

    return { errorCode: defaultErrorCode, message: defaultMessage, extras: {} };
  }

  private extractExtras(body: Record<string, unknown>): Record<string, unknown> {
    const NORMALIZED_KEYS = new Set(['code', 'error', 'statusCode', 'errorCode', 'message']);
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!NORMALIZED_KEYS.has(key)) {
        extras[key] = value;
      }
    }
    return extras;
  }

  private extractMessage(raw: unknown, fallback: string): string | string[] {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw) && raw.every((m) => typeof m === 'string')) {
      return raw as string[];
    }
    return fallback;
  }

  private isTaxonomyCode(s: string): boolean {
    return /^E_[A-Z][A-Z0-9_]*$/.test(s);
  }
}
