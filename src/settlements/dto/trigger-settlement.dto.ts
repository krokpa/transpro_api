import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TriggerSettlementDto {
  @ApiProperty({ description: 'ID du tenant (compagnie)' })
  @IsUUID()
  tenantId: string;

  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2024)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 5, description: '1 = Janvier … 12 = Décembre' })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}
