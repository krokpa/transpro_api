import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ProcessRefundAction {
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
}

export class ProcessRefundDto {
  @ApiProperty({ enum: ProcessRefundAction })
  @IsEnum(ProcessRefundAction)
  action: ProcessRefundAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Référence fournisseur si remboursement via Genius Pay' })
  @IsOptional()
  @IsString()
  providerRef?: string;
}
