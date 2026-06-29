// =============================================================================
// groq.service.ts — wrapper Groq per la generazione bozze AI (ADR-0056)
// =============================================================================
// Feature-flag a runtime sull'esistenza di GROQ_API_KEY (letta via ConfigService):
//   - key ASSENTE  → isAvailable() = false, suggerisciRisposta() lancia 503.
//     Il FE non mostra il bottone (decide da GET /ai/status, vedi AiController).
//   - key PRESENTE → client Groq inizializzato lazy alla prima richiesta.
// Nessuna persistenza: la bozza è effimera, torna al FE e popola la textarea.
// Il modello è configurabile via GROQ_MODEL (default DEFAULT_MODEL).
// =============================================================================

import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

// Modello di default se GROQ_MODEL non è settato. Versatile = buon compromesso
// qualità/latenza per testi brevi in italiano.
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

// Anti token-overflow: solo gli ultimi N messaggi (lato≠interno) entrano nel
// contesto. Il thread completo non serve per redigere la risposta all'ultimo
// messaggio cliente.
const MAX_CONTEXT_MESSAGES = 5;

const SYSTEM_PROMPT = [
  "Sei l'assistente di uno studio commercialista italiano.",
  'Scrivi una risposta professionale, concisa e in italiano al messaggio del cliente.',
  'Rispondi SOLO con il testo della risposta, senza preamboli né firme.',
].join('\n');

// Forma minima del thread necessaria a costruire il prompt. Disaccoppia il
// service Groq dal tipo Prisma completo (il chiamante mappa e filtra).
export interface ThreadPerBozza {
  oggetto: string;
  messaggi: Array<{ lato: 'studio' | 'cliente' | 'interno'; testo: string }>;
}

@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private client: Groq | undefined;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GROQ_API_KEY')?.trim() ?? '';
    this.model = this.config.get<string>('GROQ_MODEL')?.trim() || DEFAULT_MODEL;
  }

  // Feature-flag: true sse una key è configurata. Consumato da AiController.
  isAvailable(): boolean {
    return this.apiKey !== '';
  }

  // Genera la bozza di risposta dello studio all'ultimo messaggio del cliente.
  // Lancia 503 se la feature è disabilitata (nessuna key).
  async suggerisciRisposta(thread: ThreadPerBozza): Promise<string> {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException({
        errorCode: 'E_AI_DISABLED',
        message: 'AI feature disabled (no GROQ_API_KEY configured)',
      });
    }

    const userPrompt = this.buildUserPrompt(thread);

    try {
      const completion = await this.getClient().chat.completions.create({
        model: this.model,
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });

      const bozza = completion.choices[0]?.message?.content?.trim() ?? '';
      if (bozza === '') {
        throw new ServiceUnavailableException({
          errorCode: 'E_AI_EMPTY',
          message: 'AI returned an empty draft',
        });
      }
      return bozza;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      // Errore SDK/HTTP Groq (modello inesistente, rate-limit, rete): logga il
      // dettaglio lato server, espone un 503 generico al client.
      this.logger.error(`Groq request failed: ${String(err)}`);
      throw new ServiceUnavailableException({
        errorCode: 'E_AI_UPSTREAM',
        message: 'AI provider request failed',
      });
    }
  }

  // Client lazy: inizializzato alla prima richiesta (la guard isAvailable()
  // garantisce che apiKey non sia vuota quando si arriva qui).
  private getClient(): Groq {
    if (!this.client) {
      this.client = new Groq({ apiKey: this.apiKey });
    }
    return this.client;
  }

  private buildUserPrompt(thread: ThreadPerBozza): string {
    const recenti = thread.messaggi.slice(-MAX_CONTEXT_MESSAGES);
    const conversazione = recenti
      .map((m) => `[${m.lato === 'cliente' ? 'Cliente' : 'Studio'}] ${m.testo}`)
      .join('\n');
    return [
      `Oggetto: ${thread.oggetto}`,
      'Conversazione (dal più vecchio al più recente):',
      conversazione,
      "Scrivi la risposta dello studio all'ultimo messaggio del cliente.",
    ].join('\n');
  }
}
