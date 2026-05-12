// =============================================================================
// pin-validator.ts — Validazione formato + pattern forbidden per PIN POS
// =============================================================================
// Decisione 2 D2b: forbidden patterns hardcoded (4/5/6 cifre).
// Lista ~60 PIN che NON devono essere accettati:
//   - All-same: 0000, 1111, ..., 9999 (+ 5/6 cifre analoghi)
//   - Sequential ascending: 0123, 1234, ..., 6789 (+ 5/6 cifre)
//   - Sequential descending: 9876, 8765, ..., 3210 (+ 5/6 cifre)
//
// Il formato (4-6 cifre numeriche) e' validato a livello DTO via @Matches.
// Questo modulo aggiunge il check pattern OWASP-recommended per debole PIN.
//
// Use:
//   const result = validatePin('5678');
//   if (!result.valid) throw new BadRequestException(result.reason);
// =============================================================================

const ALL_SAME: string[] = [];
const SEQ_ASC: string[] = [];
const SEQ_DESC: string[] = [];

// All-same: 0000, 00000, 000000, 1111, 11111, 111111, ...
for (let d = 0; d <= 9; d++) {
  const ch = d.toString();
  for (let len = 4; len <= 6; len++) {
    ALL_SAME.push(ch.repeat(len));
  }
}

// Sequential ascending starting at 0..9-len+1
const DIGITS = '0123456789';
for (let len = 4; len <= 6; len++) {
  for (let start = 0; start <= 10 - len; start++) {
    SEQ_ASC.push(DIGITS.slice(start, start + len));
  }
}

// Sequential descending starting at 9..len-1
const REVERSED = '9876543210';
for (let len = 4; len <= 6; len++) {
  for (let start = 0; start <= 10 - len; start++) {
    SEQ_DESC.push(REVERSED.slice(start, start + len));
  }
}

export const FORBIDDEN_PINS: ReadonlySet<string> = new Set([...ALL_SAME, ...SEQ_ASC, ...SEQ_DESC]);

export interface PinValidationResult {
  valid: boolean;
  reason?: 'E_AUTH_PIN_FORBIDDEN_PATTERN';
}

export function validatePin(pin: string): PinValidationResult {
  if (FORBIDDEN_PINS.has(pin)) {
    return { valid: false, reason: 'E_AUTH_PIN_FORBIDDEN_PATTERN' };
  }
  return { valid: true };
}
