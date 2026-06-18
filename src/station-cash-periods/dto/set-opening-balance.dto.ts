import { IsInt, Min, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetOpeningBalanceDto {
  @ApiProperty({ description: 'Solde d\'ouverture en FCFA', minimum: 0 })
  @IsInt()
  @Min(0)
  openingBalance: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
