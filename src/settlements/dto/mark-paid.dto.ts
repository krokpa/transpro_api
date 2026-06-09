import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MarkPaidDto {
  @ApiProperty({ example: 'VIREMENT-2026-06-001', description: 'Référence du virement bancaire' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  transferRef: string;
}
