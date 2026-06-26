import { IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { TenantPlan, TenantStatus } from '@transpro/shared';

export class CreateTenantDto {
  @ApiProperty({ example: 'Société de Transport Ivoirienne' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'STI', description: 'Sigle ou abréviation (max 10 car.)' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  sigle?: string;

  @ApiProperty({ example: 'transport-express-ci' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiProperty({ example: '+2250700000000' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'contact@transport-express.ci' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Rue du Commerce, Plateau' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiPropertyOptional({ description: 'ID de la ville' })
  @IsOptional()
  @IsString()
  cityId?: string;

  @ApiPropertyOptional({ enum: TenantPlan, default: TenantPlan.BASIC })
  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @ApiPropertyOptional({ description: 'URL ou image encodée en base64' })
  @IsOptional()
  @IsString()
  logo?: string;

  @ApiPropertyOptional({ description: 'Latitude GPS' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value === null || value === undefined ? undefined : Number(value)))
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude GPS' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value === null || value === undefined ? undefined : Number(value)))
  longitude?: number;
}

export class UpdateTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Sigle ou abréviation (max 10 car.)' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  sigle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cityId?: string;

  @ApiPropertyOptional({ description: 'URL ou image encodée en base64' })
  @IsOptional()
  @IsString()
  logo?: string;

  @ApiPropertyOptional({ enum: TenantPlan })
  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional({ description: 'Latitude GPS' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value === null || value === undefined ? undefined : Number(value)))
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude GPS' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value === null || value === undefined ? undefined : Number(value)))
  longitude?: number;

  @ApiPropertyOptional({ description: 'Exposer cette compagnie à l’API publique tierce (opt-in)' })
  @IsOptional()
  @IsBoolean()
  publicApiEnabled?: boolean;
}

/**
 * DTO de mise à jour par la compagnie elle-même (PATCH /tenants/me).
 * Exclut `plan` et `status` : ces champs sont gérés par la facturation / le
 * super-admin uniquement. Sans cette restriction, un COMPANY_OWNER pourrait
 * changer son propre plan (gratuitement) ou se réactiver (escalade de privilèges).
 */
export class UpdateTenantSelfDto extends OmitType(UpdateTenantDto, ['plan', 'status'] as const) {}
