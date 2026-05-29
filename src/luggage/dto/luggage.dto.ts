import {
  ArrayMaxSize,
  IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumber,
  IsOptional, IsString, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@transpro/shared';

export class DeclareLuggageDto {
  @ApiProperty({ description: 'ID de la réservation' })
  @IsString()
  @IsNotEmpty()
  bookingId: string;

  @ApiProperty({ description: 'Nombre de sacs', example: 2 })
  @IsInt()
  @Min(0)
  @Max(20)
  bagCount: number;

  @ApiPropertyOptional({ description: 'Poids total en kg' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalWeightKg?: number;

  @ApiPropertyOptional({ description: 'Franchise en kg (défaut 20 kg)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freeWeightKg?: number;

  @ApiPropertyOptional({ description: 'Frais excédent payés sur-le-champ' })
  @IsOptional()
  @IsBoolean()
  excessPaid?: boolean;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  excessPaymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Descriptions des sacs (un par sac)', type: [String] })
  @IsOptional()
  @IsString({ each: true })
  bagLabels?: string[];

  @ApiPropertyOptional({ description: 'Poids individuels des sacs', type: [Number] })
  @IsOptional()
  @IsNumber({}, { each: true })
  bagWeights?: number[];
}

export class ScanBagDto {
  @ApiProperty({ description: 'Code QR du sac (ex: LG-A1B2C3D4)' })
  @IsString()
  @IsNotEmpty()
  qrCode: string;

  @ApiPropertyOptional({ description: 'ID du voyage (pour vérification)' })
  @IsOptional()
  @IsString()
  tripId?: string;
}

export class ReportMissingDto {
  @ApiPropertyOptional({ description: 'Note / description du sac manquant' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class AddBagPhotosDto {
  @ApiProperty({ description: 'Photos base64 du sac (max 2)', type: [String] })
  @IsString({ each: true })
  @ArrayMaxSize(2)
  photos: string[];
}
