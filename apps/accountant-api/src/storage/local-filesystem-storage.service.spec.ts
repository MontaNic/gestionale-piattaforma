// =============================================================================
// local-filesystem-storage.service.spec.ts — path-safety unit (ADR-0043)
// =============================================================================
// Copre la sanitizzazione anti-traversal di absFromKey (via get/delete, che la
// invocano) + un round-trip put→get→delete reale dentro una tmpdir. Scope: SOLO
// path-safety — niente MIME magic-bytes / antivirus / rate-limit (fuori scope,
// eventuale backlog ADR-0043).
// =============================================================================

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalFilesystemStorageService } from './local-filesystem-storage.service';

// tenantId UUID valido (lowercase hex) → segmento di key conforme alla shape.
const TENANT = '019e1ec8-7271-77f4-a377-6c6146726a83';

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

describe('LocalFilesystemStorageService — path safety', () => {
  let root: string;
  let svc: LocalFilesystemStorageService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'gest-storage-'));
    const config = { get: () => root } as unknown as ConfigService;
    svc = new LocalFilesystemStorageService(config);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // ── Reject espliciti (throw, NON un 500 da fs) ──────────────────────────────

  it('rifiuta key con ../ traversal', async () => {
    await expect(svc.get('../etc/passwd', 'text/plain')).rejects.toThrow(/invalid key shape/);
  });

  it('rifiuta key con path assoluto', async () => {
    await expect(svc.get('/etc/passwd', 'text/plain')).rejects.toThrow(/invalid key shape/);
    await expect(svc.delete('/etc/passwd')).rejects.toThrow(/invalid key shape/);
  });

  it('rifiuta key con null byte', async () => {
    await expect(svc.get(`${TENANT}/${TENANT}\0.txt`, 'text/plain')).rejects.toThrow(
      /invalid key shape/,
    );
  });

  it('rifiuta key sibling-prefix (root + -evil)', async () => {
    // `../<base>-evil/x` risolverebbe FUORI dalla root; lo shape guard lo blocca
    // a monte (contiene `..` e separatori extra) prima del containment check.
    await expect(svc.get('../store-evil/0000', 'text/plain')).rejects.toThrow(/invalid key shape/);
  });

  // ── Round-trip valido ────────────────────────────────────────────────────────

  it('put → get → delete round-trip dentro la tmpdir', async () => {
    const { key, size } = await svc.put({
      tenantId: TENANT,
      originalName: 'documento.txt',
      mimeType: 'text/plain',
      content: Buffer.from('contenuto allegato'),
    });
    expect(key).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.txt$/);
    expect(size).toBe(Buffer.byteLength('contenuto allegato'));

    const obj = await svc.get(key, 'text/plain');
    expect(obj.size).toBe(size);
    expect(await readAll(obj.stream)).toBe('contenuto allegato');

    await svc.delete(key);
    // Dopo il delete il file non esiste più → get rigetta (ENOENT da fs).
    await expect(svc.get(key, 'text/plain')).rejects.toThrow();
  });
});
