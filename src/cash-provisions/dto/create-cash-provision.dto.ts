import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCashProvisionDto {
  @ApiProperty({ description: 'ID de la gare à approvisionner' })
  @IsUUID()
  stationId: string;

  @ApiProperty({ example: 50000, description: 'Montant demandé en XOF (min 1 000)' })
  @IsInt()
  @Min(1000)
  amount: number;

  @ApiProperty({ example: 'Réapprovisionnement hebdomadaire caisse guichet' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
