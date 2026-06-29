// =============================================================================
// groq.service.ts — wrapper Groq per le feature AI (ADR-0056, ADR-0057)
// =============================================================================
// Feature-flag a runtime sull'esistenza di GROQ_API_KEY (letta via ConfigService):
//   - key ASSENTE  → isAvailable() = false, le chiamate lanciano 503.
//     Il FE non mostra il bottone (decide da GET /ai/status, vedi AiController).
//   - key PRESENTE → client Groq inizializzato lazy alla prima richiesta.
// Nessuna persistenza: gli output sono effimeri, tornano al FE.
// Il modello è configurabile via GROQ_MODEL (default DEFAULT_MODEL).
//
// `complete()` è il core generico (chiamata + mappatura errori 503): le feature
// (bozza risposta, insight margine) costruiscono i loro prompt e vi delegano.
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

// Default coerenti col comportamento storico di suggerisciRisposta (ADR-0056).
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 400;

const SYSTEM_PROMPT = [
  "Sei l'assistente di uno studio commercialista italiano.",
  'Scrivi una risposta professionale, concisa e in italiano al messaggio del cliente.',
  'Rispondi SOLO con il testo della risposta, senza preamboli né firme.',
].join('\n');

// Insight margine (ADR-0057): sintesi globale sui mandati. La regola esplicita
// sui dati forniti impedisce sia conclusioni su righe MANCANTE/PARZIALE sia
// caveat fantasma su mandati inesistenti (copertura pre-tariffario — ADR-0054 §7).
const MARGINE_SYSTEM_PROMPT = [
  'Sei un analista di uno studio commercialista italiano.',
  'Ricevi un elenco di mandati con i loro margini. Analizza SOLO i mandati elencati:',
  'per ciascuno indica se il margine è critico (basso o negativo) e un eventuale',
  'suggerimento operativo; se più mandati lo consentono, evidenzia pattern tra loro.',
  'REGOLE FERREE:',
  '- Parla esclusivamente dei mandati elencati. Non menzionare, contare, confrontare',
  '  con o ipotizzare mandati non presenti.',
  '- Non commentare in alcun modo cosa manca: vietate frasi come "non ci sono altri',
  '  mandati", "non sono presenti altri dati", "dati insufficienti", "non è possibile',
  '  fornire ulteriori valutazioni". Se è presente un solo mandato, descrivi solo quello.',
  '- Se un mandato ha importoPrestazioni MANCANTE/PARZIALE, dichiaralo solo per quel',
  '  mandato e non valutarne la redditività.',
  "Massimo 200 parole. Nessun preambolo: inizia direttamente con l'analisi.",
].join('\n');

// Forma minima del thread necessaria a costruire il prompt. Disaccoppia il
// service Groq dal tipo Prisma completo (il chiamante mappa e filtra).
export interface ThreadPerBozza {
  oggetto: string;
  messaggi: Array<{ lato: 'studio' | 'cliente' | 'interno'; testo: string }>;
}

// Forma minima di una riga margine per l'insight. Disaccoppia GroqService dal
// tipo `MargineRow` di ReportService (stesso pattern di ThreadPerBozza): il
// chiamante passa le sue righe, strutturalmente compatibili.
export interface MargineRigaInsight {
  codice: string;
  aziendaNome: string;
  importoConcordato: number;
  importoPrestazioni: number | null;
  margine: number | null;
  oreTotali: number;
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

  // Core generico: una completion system+user → testo trimmato. Mappa gli errori
  // su 503 con errorCode stabile (E_AI_DISABLED / E_AI_EMPTY / E_AI_UPSTREAM).
  async complete(
    systemPrompt: string,
    userPrompt: string,
    opts: { temperature?: number; maxTokens?: number } = {},
  ): Promise<string> {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException({
        errorCode: 'E_AI_DISABLED',
        message: 'AI feature disabled (no GROQ_API_KEY configured)',
      });
    }

    try {
      const completion = await this.getClient().chat.completions.create({
        model: this.model,
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const text = completion.choices[0]?.message?.content?.trim() ?? '';
      if (text === '') {
        throw new ServiceUnavailableException({
          errorCode: 'E_AI_EMPTY',
          message: 'AI returned an empty response',
        });
      }
      return text;
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

  // Genera la bozza di risposta dello studio all'ultimo messaggio del cliente.
  // Lancia 503 se la feature è disabilitata (nessuna key).
  async suggerisciRisposta(thread: ThreadPerBozza): Promise<string> {
    return this.complete(SYSTEM_PROMPT, this.buildUserPrompt(thread));
  }

  // Sintesi AI globale dei margini per mandato (ADR-0057). temperature bassa:
  // analisi, non creatività. Lancia 503 se la feature è disabilitata.
  async analizzaMargine(rows: MargineRigaInsight[]): Promise<string> {
    return this.complete(MARGINE_SYSTEM_PROMPT, this.buildMarginePrompt(rows), {
      temperature: 0.2,
      maxTokens: 400,
    });
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

  // Serializza le righe per il prompt, segnalando esplicitamente quelle con
  // importoPrestazioni null (mancante/parziale) così il modello le esclude.
  private buildMarginePrompt(rows: MargineRigaInsight[]): string {
    const righe = rows
      .map((r) => {
        const prestazioni =
          r.importoPrestazioni === null ? 'MANCANTE/PARZIALE' : r.importoPrestazioni.toFixed(2);
        const margine = r.margine === null ? 'N/D' : r.margine.toFixed(2);
        return `- ${r.aziendaNome} (mandato ${r.codice}): concordato ${r.importoConcordato.toFixed(2)}, prestazioni ${prestazioni}, margine ${margine}, ore ${r.oreTotali.toFixed(2)}`;
      })
      .join('\n');
    return [
      'Dati di margine dei mandati (importi in euro):',
      righe,
      'Le righe con prestazioni "MANCANTE/PARZIALE" non hanno importi completi: non trarre conclusioni di redditività su di esse.',
    ].join('\n');
  }
}
