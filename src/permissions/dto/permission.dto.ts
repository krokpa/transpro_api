import { IsString, IsEnum, IsArray, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PermissionCode } from '@transpro/shared';

export class CreateProfileDto {
  @ApiProperty({ example: 'Superviseur Gare' })
  @IsString()
  name: string;

  @ApiProperty({ enum: ['COMPANY', 'STATION'] })
  @IsEnum(['COMPANY', 'STATION'])
  context: 'COMPANY' | 'STATION';

  @ApiProperty({ type: [String], example: ['bookings:view', 'tickets:scan'] })
  @IsArray()
  @IsString({ each: true })
  permissions: PermissionCode[];
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: PermissionCode[];
}

export class AssignCompanyProfileDto {
  @ApiProperty({ description: 'ID utilisateur' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'ID du profil RBAC' })
  @IsString()
  profileId: string;
}

export class AssignStationProfileDto {
  @ApiProperty({ description: 'ID utilisateur' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'ID de la gare' })
  @IsString()
  stationId: string;

  @ApiProperty({ description: 'ID du profil RBAC' })
  @IsString()
  profileId: string;
}
