import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MarkFailedDto {
  @ApiPropertyOptional({ example: 'Coordonnées bancaires incorrectes — contacter la compagnie' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
