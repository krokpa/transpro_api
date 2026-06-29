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

  @ApiPropertyOptional({ example: '#0EA5E9', description: 'Accent secondaire' })
  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @ApiPropertyOptional({ example: '#6366F1', description: 'Accent tertiaire' })
  @IsOptional()
  @IsHexColor()
  tertiaryColor?: string;

  @ApiPropertyOptional({ example: '#0EA5E9', description: 'Couleur espace passager' })
  @IsOptional()
  @IsHexColor()
  passengerColor?: string;

  @ApiPropertyOptional({ example: '#10B981', description: 'Couleur espace agent' })
  @IsOptional()
  @IsHexColor()
  agentColor?: string;

  @ApiPropertyOptional({ example: '#6366F1', description: 'Couleur espace propriétaire' })
  @IsOptional()
  @IsHexColor()
  ownerColor?: string;

  @ApiPropertyOptional({ example: '#F97316', description: 'Couleur espace chauffeur' })
  @IsOptional()
  @IsHexColor()
  driverColor?: string;

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
