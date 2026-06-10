import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// =============================================================================
// create-scadenza-categoria.dto.ts — categoria scadenze CUSTOM per tenant
// (STOP-scad1)
// =============================================================================
// Le categorie piattaforma (tenant_id NULL) sono seedate e immutabili: via API
// si creano SOLO categorie custom (tenant_id = tenant corrente, valorizzato dal
// service). `colore` esadecimale #RRGGBB (default schema #3b82f6).
// =============================================================================

export class CreateScadenzaCategoriaDto {
  @IsString({ message: 'E_SCADENZA_CATEGORIA_NOME_INVALID' })
  @MinLength(1, { message: 'E_SCADENZA_CATEGORIA_NOME_REQUIRED' })
  @MaxLength(100, { message: 'E_SCADENZA_CATEGORIA_NOME_TOO_LONG' })
  nome!: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'E_SCADENZA_CATEGORIA_COLORE_INVALID' })
  colore?: string;

  @IsOptional()
  @IsInt({ message: 'E_SCADENZA_CATEGORIA_ORDINE_INVALID' })
  ordine?: number;

  @IsOptional()
  @IsBoolean({ message: 'E_SCADENZA_CATEGORIA_ATTIVO_INVALID' })
  attivo?: boolean;
}
