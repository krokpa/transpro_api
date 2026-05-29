import { IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
}
