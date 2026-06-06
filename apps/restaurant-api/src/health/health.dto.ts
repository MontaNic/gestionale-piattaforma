// =============================================================================
// health.dto.ts — Shape della response di GET /health
// =============================================================================
// Convenzione: 200 con status='ok' / db='connected' quando tutto OK,
// 503 (via ServiceUnavailableException) con status='degraded' /
// db='unreachable' quando il DB ping fallisce. Vedi ADR-0007 decisione F.
// =============================================================================

export interface HealthDto {
  status: 'ok' | 'degraded';
  db: 'connected' | 'unreachable';
  timestamp: string;
  error?: string;
}
