// =============================================================================
// local-filesystem-storage.service.ts — impl filesystem locale di StorageService
// =============================================================================
// Implementazione F1: filesystem locale sull'host Hetzner, dentro un volume
// PERSISTENTE (non effimero). Root configurabile via env `STORAGE_LOCAL_ROOT`
// (default `<cwd>/var/storage`). In prod va montato su un docker volume dedicato.
//
// Layout su disco: <root>/<tenantId>/<uuid><ext>. La chiave opaca ritornata è
// il path RELATIVO alla root (`<tenantId>/<uuid><ext>`): mai assoluto, così uno
// swap di root non invalida le chiavi persistite. Il nome originale NON entra
// nel path (anti path-traversal): è solo un metadato su ComAllegato.nomeOrig.
// =============================================================================

import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import { Inject, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { id } from '@gestionale/db';

import {
  STORAGE_MAX_UPLOAD_BYTES,
  StorageService,
  type StorageObject,
  type StoragePutInput,
  type StoragePutResult,
} from './storage.service';

@Injectable()
export class LocalFilesystemStorageService extends StorageService {
  private readonly logger = new Logger(LocalFilesystemStorageService.name);
  private readonly root: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    super();
    this.root = resolve(
      config.get<string>('STORAGE_LOCAL_ROOT') ?? join(process.cwd(), 'var', 'storage'),
    );
  }

  async put(input: StoragePutInput): Promise<StoragePutResult> {
    if (input.content.byteLength > STORAGE_MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException({
        errorCode: 'E_ALLEGATO_TOO_LARGE',
        message: `Allegato exceeds ${STORAGE_MAX_UPLOAD_BYTES} bytes`,
      });
    }

    // Chiave relativa: <tenantId>/<uuid><ext>. tenantId è un UUID validato a
    // monte (RLS), quindi safe come segmento di path.
    const ext = safeExt(input.originalName);
    const key = `${input.tenantId}/${id()}${ext}`;
    const abs = this.absFromKey(key);

    await mkdir(resolve(abs, '..'), { recursive: true });
    await writeFile(abs, input.content);

    this.logger.log(`stored ${key} (${input.content.byteLength}B) tenant=${input.tenantId}`);
    return { key, size: input.content.byteLength };
  }

  async get(key: string, mimeType: string): Promise<StorageObject> {
    const abs = this.absFromKey(key);
    const info = await stat(abs); // throw ENOENT se assente → 500 esplicito
    return { stream: createReadStream(abs), size: info.size, mimeType };
  }

  async delete(key: string): Promise<void> {
    await rm(this.absFromKey(key), { force: true }); // idempotente
  }

  // Risolve la chiave opaca a path assoluto. Due barriere in sequenza:
  //   1. Guard di shape A MONTE: rifiuta null byte e qualunque key fuori dalla
  //      forma attesa `<tenantId-uuid>/<id-uuid>(.ext)?` PRIMA di toccare fs →
  //      `../`, path assoluti, separatori extra, byte di controllo → Error pulito.
  //   2. Containment (defense-in-depth): anche se la shape passasse, il path
  //      risolto deve restare DENTRO la root (`resolve` + `startsWith(root+sep)`).
  private absFromKey(key: string): string {
    if (key.includes('\0') || !KEY_SHAPE.test(key)) {
      throw new Error(`StorageService: invalid key shape: '${key}'`);
    }
    const abs = resolve(this.root, key);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) {
      throw new Error(`StorageService: key escapes storage root: '${key}'`);
    }
    return abs;
  }
}

// Forma attesa della key opaca: `<tenantId-uuid>/<id-uuid>(.ext)?`. UUID =
// 36 char in [0-9a-f-]; ext lowercase alnum ≤10. Niente `..`, niente separatori
// multipli, niente path assoluti possono matcharla.
const KEY_SHAPE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$/;

// Estensione safe (lowercase, solo alnum, max 10) o stringa vuota. Mai parte del
// path significativa: serve solo a preservare il tipo file per la serve.
function safeExt(originalName: string): string {
  const raw = extname(originalName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(raw) ? raw : '';
}
