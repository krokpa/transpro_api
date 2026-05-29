import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TripClass } from '@transpro/shared';

export class CreateScheduleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  routeId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional({ description: 'Gare de départ (propagée aux voyages générés)' })
  @IsOptional()
  @IsString()
  departureStationId?: string;

  @ApiPropertyOptional({ description: 'Gare d\'arrivée (propagée aux voyages générés)' })
  @IsOptional()
  @IsString()
  arrivalStationId?: string;

  @ApiProperty({ example: 'Abidjan → Bouaké 08h00 Standard' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ example: '08:00', description: 'Heure de départ HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'Format HH:MM requis' })
  departureTime: string;

  @ApiProperty({ example: [1, 2, 3, 4, 5], description: '0=Dim, 1=Lun, ..., 6=Sam' })
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek: number[];

  @ApiProperty({ enum: TripClass, default: TripClass.STANDARD })
  @IsEnum(TripClass)
  tripClass: TripClass;

  @ApiProperty({ example: 3500 })
  @IsInt()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: ['AC', 'WIFI'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional({ default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  generateDaysAhead?: number;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departureStationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  arrivalStationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'Format HH:MM requis' })
  departureTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  daysOfWeek?: number[];

  @ApiPropertyOptional({ enum: TripClass })
  @IsOptional()
  @IsEnum(TripClass)
  tripClass?: TripClass;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  generateDaysAhead?: number;
}

export class GenerateTripsDto {
  @ApiPropertyOptional({ default: 7, description: 'Nombre de jours à générer' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  daysAhead?: number;
}
