import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RouteStopDto {
  @ApiPropertyOptional({ description: 'ID de la ville (optionnel)' })
  @IsOptional()
  @IsString()
  cityId?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  order: number;

  @ApiProperty({ example: 90 })
  @IsInt()
  @Min(0)
  durationFromOriginMinutes: number;

  @ApiProperty({ example: 2500 })
  @IsInt()
  @Min(0)
  priceFromOrigin: number;
}

export class CreateRouteDto {
  @ApiProperty({ example: 'Abidjan - Bouaké Express' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'ID de la ville de départ' })
  @IsOptional()
  @IsString()
  originCityId?: string;

  @ApiPropertyOptional({ description: 'ID de la ville de destination' })
  @IsOptional()
  @IsString()
  destinationCityId?: string;

  @ApiProperty({ example: 360 })
  @IsInt()
  @Min(1)
  distanceKm: number;

  @ApiProperty({ example: 300 })
  @IsInt()
  @Min(1)
  durationMinutes: number;

  @ApiProperty({ example: 5000 })
  @IsInt()
  @Min(0)
  basePrice: number;

  @ApiPropertyOptional({ type: [RouteStopDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouteStopDto)
  stops?: RouteStopDto[];
}

export class UpdateRouteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originCityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinationCityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  distanceKm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [RouteStopDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouteStopDto)
  stops?: RouteStopDto[];
}
