import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class AddRigaDto {
  @IsString({ message: 'E_CONTO_ARTICLE_INVALID' })
  @MinLength(1, { message: 'E_CONTO_ARTICLE_REQUIRED' })
  articleId!: string;

  @IsInt({ message: 'E_CONTO_QUANTITA_INVALID' })
  @Min(1, { message: 'E_CONTO_QUANTITA_INVALID' })
  quantita!: number;

  // Annotazione cucina per-riga (KDS, ADR-0069). Opzionale; max 200 char
  // (coerente con gli altri short-text del dominio). AI/NL fuori scope.
  @IsOptional()
  @IsString({ message: 'E_CONTO_NOTE_INVALID' })
  @MaxLength(200, { message: 'E_CONTO_NOTE_TOO_LONG' })
  note?: string;
}
