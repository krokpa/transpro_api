import { IsHexColor, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ example: 'TransPro CI' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  appName?: string;

  @ApiPropertyOptional({ example: 'Voyagez en toute sérénité' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tagline?: string;

  @ApiPropertyOptional({ example: '#F97316' })
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @ApiPropertyOptional({ description: 'URL ou data-URI du logo' })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}
