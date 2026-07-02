import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateRigaDto {
  // PATCH riga = quantità (obbligatoria) + note opzionale (prezzo/nome/reparto
  // sono snapshot congelati, non modificabili — DP-C). Patch senza quantità = 400.
  @IsInt({ message: 'E_CONTO_QUANTITA_INVALID' })
  @Min(1, { message: 'E_CONTO_QUANTITA_INVALID' })
  quantita!: number;

  // Annotazione cucina per-riga (KDS, ADR-0069). Editabile solo su riga PENDING
  // (riga inviata → 409 E_RIGA_ALREADY_SENT). `undefined` = campo lasciato invariato.
  @IsOptional()
  @IsString({ message: 'E_CONTO_NOTE_INVALID' })
  @MaxLength(200, { message: 'E_CONTO_NOTE_TOO_LONG' })
  note?: string;
}
