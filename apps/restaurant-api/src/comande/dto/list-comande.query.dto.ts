import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

import { PrintDepartment, StatoComanda } from '@gestionale/db';

// Query filtri per il feed KDS GET /comande. Tutti opzionali:
//   - stato assente  ⇒ default "non-pronte" (inviata + in_preparazione) — il
//     board cucina di norma vuole solo ciò che resta da preparare.
//   - reparto        ⇒ filtro per postazione (cucina/pizzeria/bar).
//   - contoId        ⇒ comande di un singolo conto.
export class ListComandeQueryDto {
  @IsOptional()
  @IsEnum(StatoComanda, { message: 'E_COMANDA_STATO_INVALID' })
  stato?: StatoComanda;

  @IsOptional()
  @IsEnum(PrintDepartment, { message: 'E_COMANDA_REPARTO_INVALID' })
  reparto?: PrintDepartment;

  @IsOptional()
  @IsString({ message: 'E_COMANDA_CONTO_INVALID' })
  @MinLength(1, { message: 'E_COMANDA_CONTO_INVALID' })
  contoId?: string;
}
