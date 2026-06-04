import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

// =============================================================================
// MailService — SMTP transporter wrapper per notifiche security (B2a)
// =============================================================================
// Pattern (ADR-0014):
//   - Transporter unico nodemailer (Mailpit in dev, provider esterno in prod
//     via env vars).
//   - onModuleInit: transporter.verify() + log success/warn (FAIL-OPEN, no
//     throw — auth flow continua a funzionare anche se SMTP down).
//   - onModuleDestroy: transporter.close().
//   - sendMail wrappato in try/catch + log warn su error: una mail persa NON
//     deve rompere il flow di auth (security notification e' supportiva,
//     non critica per il funzionamento del sistema).
//
// Auth conditional: nodemailer con auth: undefined accetta server senza SASL
// (Mailpit default). Auth con user/pass vuote `{user: '', pass: ''}` fa
// fallire alcuni server SMTP strict → conditional in constructor evita.
//
// Template HTML inline minimale: niente engine (Handlebars/EJS) finche' non
// ci sono >2-3 template diversi. Se cresce → TD-AA ADR-0014.
//
// PII / Security: email content MAI include password, JWT token, refresh
// token, session id. Solo: indirizzo IP, user agent, timestamp, motivo
// breve. Lockout key NON in email (privacy).
// Pattern: quando serve riferimento user, usare hash sha256[0:8] coerente
// con audit log (es. identifierHash per lockout, mai user.email plain).
// =============================================================================

interface AccountLockedContext {
  to: string;
  /** Hash sha256[0:8] della lockout key (no plaintext email/deviceId). */
  identifierHash: string;
  tenantSlug: string | null;
  source: 'login' | 'login-pin';
  lockoutDurationMin: number;
}

interface RefreshTokenTheftContext {
  to: string;
  attackerIp: string | null;
  attackerUserAgent: string | null;
  revokedSessionCount: number;
}

@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  // @Inject esplicito (vedi RedisService — Discovery #29 B2b).
  constructor(@Inject(ConfigService) config: ConfigService) {
    const host = config.get<string>('SMTP_HOST') ?? '127.0.0.1';
    const port = Number(config.get<string>('SMTP_PORT') ?? '1025');
    const secure = config.get<string>('SMTP_SECURE') === 'true';
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');
    this.from = config.get<string>('SMTP_FROM') ?? 'no-reply@gestionale.local';

    // Auth conditional: server SMTP strict (es. Postmark) rifiutano AUTH con
    // credenziali vuote. Mailpit dev accetta no-auth. Vedi pre-Fase 2 note.
    const auth = user && pass ? { user, pass } : undefined;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth,
    });
  }

  async onModuleInit(): Promise<void> {
    // Fail-open: verify() probe SMTP. Fail logga warn ma NON crasha l'app —
    // auth flow continua a funzionare; le email non verranno inviate finche'
    // SMTP non torna disponibile.
    try {
      await this.transporter.verify();
      this.log.log('SMTP transporter verified (connection OK)');
    } catch (err) {
      this.log.warn(`SMTP verify failed at boot: ${this.errMsg(err)}. Dev-tolerant, continuing.`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.transporter.close();
  }

  // ---------------------------------------------------------------------------
  // sendAccountLockedEmail — notifica utente di lockout
  // ---------------------------------------------------------------------------
  // Trigger: AuthService promuove (tenantId, email) o (tenantId, deviceId) a
  // lockout. Email content rivela SOLO: durata blocco + motivo generico + IP
  // sorgente (se disponibile). MAI: email plaintext, password, token.
  /**
   * Return true se l'email e' stata effettivamente inviata, false se sendSafe
   * ha catchato error (fail-open). Permette al caller di tracciare il flag
   * `emailSent` nell'audit metadata senza duplicare audit rows.
   */
  async sendAccountLockedEmail(ctx: AccountLockedContext): Promise<boolean> {
    const subject = '[Gestionale] Account temporaneamente bloccato';
    const tenantLine = ctx.tenantSlug
      ? `<p>Tenant: <strong>${escapeHtml(ctx.tenantSlug)}</strong></p>`
      : '';
    const sourceLabel = ctx.source === 'login-pin' ? 'login PIN POS' : 'login email/password';

    const html = `<!doctype html>
<html lang="it"><body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
<h2>Account temporaneamente bloccato</h2>
<p>Sono stati rilevati troppi tentativi falliti di <strong>${sourceLabel}</strong> sul tuo account.</p>
<p>Per protezione, l'accesso e' stato bloccato per <strong>${ctx.lockoutDurationMin} minuti</strong>.</p>
${tenantLine}
<p>Identificatore (anonimizzato): <code>${ctx.identifierHash}</code></p>
<p><strong>Cosa fare</strong>:</p>
<ul>
<li>Se sei stato tu, attendi ${ctx.lockoutDurationMin} minuti e riprova.</li>
<li>Se NON sei stato tu, contatta l'amministratore: qualcuno potrebbe star tentando di accedere al tuo account.</li>
</ul>
<p style="color: #666; font-size: 0.85em;">Questa è una notifica automatica di sicurezza. Non rispondere a questa email.</p>
</body></html>`;

    return this.sendSafe({ to: ctx.to, subject, html });
  }

  // ---------------------------------------------------------------------------
  // sendRefreshTokenTheftEmail — notifica utente di session theft detection
  // ---------------------------------------------------------------------------
  // Trigger: AuthService.refresh rileva refresh token rotato + riusato
  // (theft FULL D2-vitest). Tutte le sessioni del user sono state revocate.
  async sendRefreshTokenTheftEmail(ctx: RefreshTokenTheftContext): Promise<boolean> {
    const subject = '[Gestionale] Attività sospetta — sessioni revocate';
    const ipLine = ctx.attackerIp
      ? `<li>Indirizzo IP: <code>${escapeHtml(ctx.attackerIp)}</code></li>`
      : '';
    const uaLine = ctx.attackerUserAgent
      ? `<li>Client: <code>${escapeHtml(ctx.attackerUserAgent)}</code></li>`
      : '';

    const html = `<!doctype html>
<html lang="it"><body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
<h2>Attività sospetta rilevata sul tuo account</h2>
<p>È stato rilevato il riutilizzo di un token già invalidato. Questo può indicare che un attaccante è in possesso delle tue credenziali di sessione.</p>
<p><strong>Per protezione, abbiamo revocato ${ctx.revokedSessionCount} sessione/i attiva/e.</strong> Dovrai effettuare nuovamente il login da tutti i dispositivi.</p>
<p><strong>Dettagli del tentativo</strong>:</p>
<ul>
${ipLine}
${uaLine}
<li>Sessioni revocate: ${ctx.revokedSessionCount}</li>
</ul>
<p><strong>Azioni raccomandate</strong>:</p>
<ul>
<li>Cambia la password al prossimo login.</li>
<li>Se hai accesso a una console amministrativa, verifica l'audit log per dettagli.</li>
<li>Se non riconosci l'attività, contatta immediatamente l'amministratore.</li>
</ul>
<p style="color: #666; font-size: 0.85em;">Questa è una notifica automatica di sicurezza. Non rispondere a questa email.</p>
</body></html>`;

    return this.sendSafe({ to: ctx.to, subject, html });
  }

  // ---------------------------------------------------------------------------
  // Helpers privati
  // ---------------------------------------------------------------------------

  private async sendSafe(args: { to: string; subject: string; html: string }): Promise<boolean> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
      });
      this.log.log(`Mail sent to=${args.to} subject="${args.subject}" id=${info.messageId}`);
      return true;
    } catch (err) {
      this.log.warn(
        `Mail send failed (fail-open) to=${args.to} subject="${args.subject}": ${this.errMsg(err)}`,
      );
      return false;
    }
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

// HTML escape minimale per i campi dinamici inseriti nel template.
// Non rendiamo dipendenza da `he` o simili — i campi sono sotto controllo
// applicativo (slug regex-validati, IP, user-agent), il rischio injection
// e' basso. Escape difensivo coperto qui senza dep esterna.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
