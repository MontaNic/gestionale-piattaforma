import { IsInt, Min } from 'class-validator';

export class UpdateRigaDto {
  // PATCH riga = solo la quantità (prezzo/nome/reparto sono snapshot congelati,
  // non modificabili — DP-C). Quantità obbligatoria: patch senza quantità = 400.
  @IsInt({ message: 'E_CONTO_QUANTITA_INVALID' })
  @Min(1, { message: 'E_CONTO_QUANTITA_INVALID' })
  quantita!: number;
}
