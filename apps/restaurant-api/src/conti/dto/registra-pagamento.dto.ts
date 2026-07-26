import { IsEnum, IsNumber, Max, Min } from 'class-validator';

import { MetodoPagamentoConto } from '@gestionale/db';

/**
 * Registrazione di un pagamento sul conto (Cassa pre-fiscale, ADR-0081).
 *
 * `importo` = importo **applicato al conto**, non versato: il resto contanti è
 * concern FE (TD-cassa-resto-drawer). Vincoli:
 *   - `maxDecimalPlaces: 2` → coerente con Decimal(10,2) in DB (un 3° decimale
 *     verrebbe troncato silenziosamente dal driver: meglio 400 esplicito).
 *   - `Min(0.01)` → un pagamento da 0 non è un pagamento (e renderebbe
 *     ambiguo `statoPagamento`: pagato>0 ma residuo invariato).
 *   - `Max(99999999.99)` → capienza di Decimal(10,2). Il tetto REALE è il
 *     residuo del conto, verificato nel service (E_PAGAMENTO_EXCEEDS_RESIDUO):
 *     qui si respinge solo l'input strutturalmente impossibile.
 */
export class RegistraPagamentoDto {
  @IsEnum(MetodoPagamentoConto, { message: 'E_PAGAMENTO_METODO_INVALID' })
  metodo!: MetodoPagamentoConto;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_PAGAMENTO_IMPORTO_INVALID' })
  @Min(0.01, { message: 'E_PAGAMENTO_IMPORTO_INVALID' })
  @Max(99_999_999.99, { message: 'E_PAGAMENTO_IMPORTO_INVALID' })
  importo!: number;
}
