import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

import { Channel } from '@gestionale/db';

export class CreateContoDto {
  @IsEnum(Channel, { message: 'E_CONTO_CHANNEL_INVALID' })
  channel!: Channel;

  // Coperti: opzionale (asporto/delivery non ne hanno). Coerenza con il canale
  // NON è forzata qui — resta libera (un tavolo può avere coperti, ma non è un
  // vincolo di scope-lock PR-2).
  @IsOptional()
  @IsInt({ message: 'E_CONTO_COPERTI_INVALID' })
  @Min(1, { message: 'E_CONTO_COPERTI_INVALID' })
  coperti?: number;

  // tavoloId: la coerenza canale↔tavolo è enforce NEL SERVICE (D3), non qui:
  // `cassa ⇒ obbligatorio`, `asporto/delivery/menu_online ⇒ assente`.
  @IsOptional()
  @IsString({ message: 'E_CONTO_TAVOLO_INVALID' })
  @MinLength(1, { message: 'E_CONTO_TAVOLO_INVALID' })
  tavoloId?: string;
}
