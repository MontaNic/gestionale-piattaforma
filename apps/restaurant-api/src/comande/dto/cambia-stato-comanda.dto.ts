import { IsEnum } from 'class-validator';

import { StatoComanda } from '@gestionale/db';

// Body di PATCH /comande/:id/stato. Il target dev'essere un StatoComanda valido;
// la validità della TRANSIZIONE (forward-only) è enforce nel service, non qui.
export class CambiaStatoComandaDto {
  @IsEnum(StatoComanda, { message: 'E_COMANDA_STATO_INVALID' })
  stato!: StatoComanda;
}
