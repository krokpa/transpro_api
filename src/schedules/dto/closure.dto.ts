import { IsString, IsDateString, IsBoolean, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClosureDayDto {
  @ApiProperty({ example: '2025-08-07', description: 'Date de fermeture (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: 'Fête Nationale' })
  @IsString()
  @MaxLength(100)
  label: string;

  @ApiPropertyOptional({ default: false, description: 'Si true, s\'applique chaque année (même mois/jour)' })
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;
}
