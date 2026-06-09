import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SendProvisionDto {
  @ApiPropertyOptional({ example: 'Virement Mobile Money réf. MM-2026-001' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
