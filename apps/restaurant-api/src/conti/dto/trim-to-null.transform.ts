import { Transform } from 'class-transformer';

// =============================================================================
// trim-to-null.transform.ts — normalizzazione campi testo opzionali "clearable"
// =============================================================================
// Semantica (Delta A, KDS): distingue tre casi che Prisma tratta diversamente
// su update parziale — NON collassarli tra loro.
//   - undefined (chiave omessa)  → resta undefined → Prisma ignora la key (skip)
//   - null (clear esplicito)     → resta null      → Prisma setta NULL
//   - stringa                    → trim; se vuota dopo trim → null; altrimenti trimmata
//
// CRITICO: `undefined` NON deve diventare `null`, altrimenti un update senza il
// campo cancellerebbe silenziosamente il valore preesistente. Un non-stringa
// passa inalterato: lo scarta il successivo @IsString.
// =============================================================================
export const TrimToNull = (): PropertyDecorator =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });
