import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TripStatus, TripClass } from '@transpro/shared';

export class CreateTripDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  routeId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiProperty({ example: '2025-01-20T06:00:00Z' })
  @IsDateString()
  departureAt: string;

  @ApiPropertyOptional({ example: '2025-01-20T10:00:00Z', description: 'Calculé automatiquement si absent' })
  @IsOptional()
  @IsDateString()
  estimatedArrivalAt?: string;

  @ApiProperty({ example: 3500 })
  @IsInt()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ enum: TripClass, default: TripClass.STANDARD })
  @IsOptional()
  @IsEnum(TripClass)
  tripClass?: TripClass;

  @ApiPropertyOptional({ example: ['AC', 'WIFI'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departureStationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  arrivalStationId?: string;
}

export class UpdateTripStatusDto {
  @ApiProperty({ enum: TripStatus })
  @IsEnum(TripStatus)
  status: TripStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  delayMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SearchTripsDto {
  @ApiProperty({ example: 'Abidjan' })
  @IsString()
  @IsNotEmpty()
  origin: string;

  @ApiProperty({ example: 'Bouaké' })
  @IsString()
  @IsNotEmpty()
  destination: string;

  @ApiProperty({ example: '2025-01-20' })
  @IsDateString()
  departureDate: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  passengers?: number;

  @ApiPropertyOptional({ enum: TripClass })
  @IsOptional()
  @IsEnum(TripClass)
  tripClass?: TripClass;
}
