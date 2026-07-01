import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class AddRigaDto {
  @IsString({ message: 'E_CONTO_ARTICLE_INVALID' })
  @MinLength(1, { message: 'E_CONTO_ARTICLE_REQUIRED' })
  articleId!: string;

  @IsInt({ message: 'E_CONTO_QUANTITA_INVALID' })
  @Min(1, { message: 'E_CONTO_QUANTITA_INVALID' })
  quantita!: number;
}
