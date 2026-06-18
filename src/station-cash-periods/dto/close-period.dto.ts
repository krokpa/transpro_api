import { IsInt, Min, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClosePeriodDto {
  @ApiProperty({ description: 'Solde physique compté en caisse (FCFA)', minimum: 0 })
  @IsInt()
  @Min(0)
  declaredBalance: number;

  @ApiProperty({ required: false, description: 'Explication si écart (variance ≠ 0)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
