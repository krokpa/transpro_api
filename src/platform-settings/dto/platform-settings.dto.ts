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

  @ApiPropertyOptional({ description: 'URL ou data-URI du logo (affiché dans l\'app)' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'URL ou data-URI du favicon (icône carrée)' })
  @IsOptional()
  @IsString()
  faviconUrl?: string;

  @ApiPropertyOptional({ description: 'URL ou data-URI de l\'image de partage (Open Graph)' })
  @IsOptional()
  @IsString()
  ogImageUrl?: string;
}
