import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PROMOTION_TYPES = ['PROMO', 'NEWS', 'ALERT'] as const;
type PromotionTypeStr = (typeof PROMOTION_TYPES)[number];

export class CreatePromotionDto {
  @ApiPropertyOptional({ enum: PROMOTION_TYPES, default: 'PROMO' })
  @IsOptional()
  @IsIn(PROMOTION_TYPES)
  type?: PromotionTypeStr;

  @ApiProperty({ example: '-20% sur votre 1ʳᵉ réservation' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Valable jusqu’au 31 juillet' })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'BIENVENUE20' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 'En profiter' })
  @IsOptional()
  @IsString()
  ctaLabel?: string;

  @ApiPropertyOptional({ example: '/passenger/search' })
  @IsOptional()
  @IsString()
  ctaUrl?: string;

  @ApiPropertyOptional({ example: '#F97316' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ example: '2026-07-31T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({ description: 'null = promotion plateforme' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class UpdatePromotionDto extends CreatePromotionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declare title: string;
}
