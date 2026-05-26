import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { VehicleStatus } from '@transpro/shared';

export class SeatConfigDto {
  @ApiProperty({ example: '1A' })
  @IsString()
  number: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  row: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  column: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAisle?: boolean;

  @ApiPropertyOptional({ example: 'STANDARD' })
  @IsOptional()
  @IsString()
  class?: string;
}

export class SeatLayoutDto {
  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(1)
  rows: number;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  columns: number;

  @ApiPropertyOptional({ type: [SeatConfigDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatConfigDto)
  seats?: SeatConfigDto[];
}

export class CreateVehicleDto {
  @ApiProperty({ example: 'AB-1234-CI' })
  @IsString()
  @IsNotEmpty()
  plate: string;

  @ApiProperty({ example: 'Mercedes' })
  @IsString()
  @IsNotEmpty()
  brand: string;

  @ApiProperty({ example: 'Sprinter' })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({ example: 2022 })
  @IsInt()
  @Min(1990)
  year: number;

  @ApiProperty({ example: 40 })
  @IsInt()
  @Min(1)
  capacity: number;

  @ApiPropertyOptional({ type: SeatLayoutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SeatLayoutDto)
  seatLayout?: SeatLayoutDto;
}

export class UpdateVehicleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  plate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1990)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional({ enum: VehicleStatus })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  @ApiPropertyOptional({ type: SeatLayoutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SeatLayoutDto)
  seatLayout?: SeatLayoutDto;
}
