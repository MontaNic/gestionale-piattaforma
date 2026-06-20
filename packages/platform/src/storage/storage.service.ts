// =============================================================================
// storage.service.ts — astrazione storage provider-agnostica (ADR-0043)
// =============================================================================
// Comunicazioni è il PRIMO consumer (allegati messaggi). L'interfaccia è
// volutamente neutra rispetto al backend fisico: i consumer dipendono SOLO da
// questo token astratto, mai da `fs` o da un SDK cloud. Questo permette di
// swappare l'implementazione (filesystem locale Hetzner → Cloudflare R2) senza
// toccare alcun consumer (decisione storage 10/06).
//
// `key` è una stringa OPACA generata dall'implementazione: i consumer la
// persistono (ComAllegato.percorso) e la ripassano a serve/delete. NON è un path
// filesystem né un URL: l'implementazione locale la mappa su un path, quella R2
// la userà come object key.
// =============================================================================

import type { Readable } from 'node:stream';

/** Limite upload allegati: 20MB (decisione 10/06). */
export const STORAGE_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface StoragePutInput {
  /** Tenant proprietario — usato per partizionare lo storage per-tenant. */
  tenantId: string;
  /** Nome file originale (solo metadato; NON usato come path per evitare traversal). */
  originalName: string;
  /** MIME dichiarato. */
  mimeType: string;
  /** Contenuto del file. */
  content: Buffer;
}

export interface StoragePutResult {
  /** Chiave opaca da persistere e ripassare a serve/delete. */
  key: string;
  /** Dimensione in byte effettivamente scritta. */
  size: number;
}

export interface StorageObject {
  stream: Readable;
  size: number;
  mimeType: string;
}

/**
 * Token DI astratto. Registrato in StorageModule con
 * `{ provide: StorageService, useClass: LocalFilesystemStorageService }`.
 * I consumer iniettano `StorageService`, mai l'impl concreta.
 */
export abstract class StorageService {
  /** Salva un blob e ritorna la chiave opaca. Valida la dimensione (≤ 20MB). */
  abstract put(input: StoragePutInput): Promise<StoragePutResult>;

  /** Recupera un blob dalla sua chiave. Throw se assente. */
  abstract get(key: string, mimeType: string): Promise<StorageObject>;

  /** Cancella un blob. Idempotente: no-op se già assente. */
  abstract delete(key: string): Promise<void>;
}
