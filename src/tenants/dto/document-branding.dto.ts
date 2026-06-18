import { IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDocumentBrandingDto {
  @ApiProperty({ enum: ['none', 'header', 'watermark', 'both'] })
  @IsEnum(['none', 'header', 'watermark', 'both'])
  logoPosition: 'none' | 'header' | 'watermark' | 'both';

  @ApiPropertyOptional({ minimum: 0.03, maximum: 0.30, example: 0.07 })
  @IsNumber()
  @Min(0.03)
  @Max(0.30)
  @IsOptional()
  watermarkOpacity?: number;

  @ApiPropertyOptional({ maxLength: 80, example: 'STI — Société des Transports Ivoiriens' })
  @IsString()
  @MaxLength(80)
  @IsOptional()
  footerText?: string;
}
