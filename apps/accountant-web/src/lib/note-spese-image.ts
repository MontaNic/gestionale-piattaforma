// =============================================================================
// note-spese-image.ts — compressione immagini client-side (§5/§8)
// =============================================================================
// Resize a ~1280px sul lato lungo + JPEG q0.7 PRIMA dell'upload. Responsabilità
// FE, nessun impatto BE (il cap 20MB resta lato server).
//
// Regole:
// - SOLO immagini: un PDF passa intatto (mai ricodificato).
// - L'output è `image/jpeg`, che resta nella allow-list MIME del backend.
// - Se la compressione fallisce (canvas indisponibile, decode KO) o non riduce
//   davvero il peso → si carica l'ORIGINALE: mai bloccare l'utente.
// Nessuna dipendenza esterna (nel repo non esisteva alcuna utility di resize).
// =============================================================================

export const COMPRESS_MAX_SIDE = 1280;
export const COMPRESS_QUALITY = 0.7;

function toJpgName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}

/**
 * Ritorna una versione compressa dell'immagine, o il file originale se non è
 * un'immagine / la compressione non conviene / qualcosa va storto.
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file; // PDF & co.: intatti

  try {
    const bitmap = await createImageBitmap(file);
    const lato = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, COMPRESS_MAX_SIDE / lato);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', COMPRESS_QUALITY),
    );
    // Se non abbiamo guadagnato peso, teniamo l'originale (evita di ricodificare
    // in peggio una foto già ottimizzata).
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], toJpgName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file; // fallback esplicito: si carica l'originale
  }
}
