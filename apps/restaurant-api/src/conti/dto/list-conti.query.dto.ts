import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

import { StatoConto } from '@gestionale/db';

// Query filtri opzionali per GET /conti (PR-1 FE comande). Backward-compat:
// nessun param ⇒ DTO vuoto valido ⇒ lista invariata (where solo su tenantId).
export class ListContiQueryDto {
  @IsOptional()
  @IsEnum(StatoConto, { message: 'E_CONTO_STATO_INVALID' })
  stato?: StatoConto;

  // tavoloId è String (cuid/uuid) come CreateContoDto: @IsString, non @IsUUID.
  @IsOptional()
  @IsString({ message: 'E_CONTO_TAVOLO_INVALID' })
  @MinLength(1, { message: 'E_CONTO_TAVOLO_INVALID' })
  tavoloId?: string;
}
