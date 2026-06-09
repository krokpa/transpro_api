import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MarkProcessingDto {
  @ApiPropertyOptional({ example: 'Ecobank Côte d\'Ivoire' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: 'CI001234567890123' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bankAccount?: string;
}
