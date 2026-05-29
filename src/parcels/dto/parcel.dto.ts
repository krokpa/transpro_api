import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@transpro/shared';

export class CreateParcelDto {
  @ApiProperty({ description: 'ID du voyage' })
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiPropertyOptional({ description: 'ID de la gare d\'envoi' })
  @IsOptional()
  @IsString()
  stationId?: string;

  // Expéditeur (auto-rempli si passager connecté)
  @ApiPropertyOptional({ description: 'Nom de l\'expéditeur (guichet)' })
  @IsOptional()
  @IsString()
  senderName?: string;

  @ApiPropertyOptional({ description: 'Téléphone de l\'expéditeur (guichet)' })
  @IsOptional()
  @IsString()
  senderPhone?: string;

  @ApiPropertyOptional({ description: 'Email de l\'expéditeur (facultatif, pour les non-inscrits)' })
  @IsOptional()
  @IsString()
  senderEmail?: string;

  // Destinataire (passager inscrit ou anonyme)
  @ApiPropertyOptional({ description: 'ID du destinataire si passager inscrit' })
  @IsOptional()
  @IsString()
  recipientId?: string;

  @ApiProperty({ description: 'Nom du destinataire' })
  @IsString()
  @IsNotEmpty()
  recipientName: string;

  @ApiProperty({ description: 'Téléphone du destinataire' })
  @IsString()
  @IsNotEmpty()
  recipientPhone: string;

  @ApiPropertyOptional({ description: 'Email du destinataire (optionnel, pour notifications)' })
  @IsOptional()
  @IsString()
  recipientEmail?: string;

  @ApiProperty({ description: 'Ville de livraison' })
  @IsString()
  @IsNotEmpty()
  deliveryCity: string;

  @ApiProperty({ description: 'Description du colis' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Poids en kg', example: 2.5 })
  @IsNumber()
  @IsPositive()
  @Max(50)
  weightKg: number;

  @ApiPropertyOptional({ description: 'Colis fragile', default: false })
  @IsOptional()
  @IsBoolean()
  fragile?: boolean;

  @ApiPropertyOptional({ description: 'Valeur déclarée en FCFA' })
  @IsOptional()
  @IsInt()
  @Min(0)
  declaredValue?: number;

  @ApiPropertyOptional({ description: 'Frais calculés ou saisis manuellement' })
  @IsOptional()
  @IsInt()
  @Min(0)
  fee?: number;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateParcelStatusDto {
  @ApiProperty({ description: 'Nouveau statut', example: 'IN_TRANSIT' })
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDeliveryRequestDto {
  @ApiProperty({ description: 'Adresse complète de livraison' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiPropertyOptional({ description: 'Quartier / commune' })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiPropertyOptional({ description: 'Point de repère (ex: En face de la mosquée)' })
  @IsOptional()
  @IsString()
  landmark?: string;

  @ApiPropertyOptional({ description: 'Latitude GPS' })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude GPS' })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiProperty({ description: 'Nom du contact pour la livraison' })
  @IsString()
  @IsNotEmpty()
  contactName: string;

  @ApiProperty({ description: 'Téléphone du contact' })
  @IsString()
  @IsNotEmpty()
  contactPhone: string;
}

export class UpdateDeliveryRequestDto {
  @ApiPropertyOptional({ description: 'Nouveau statut' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'ID de l\'agent assigné' })
  @IsOptional()
  @IsString()
  handlerId?: string;

  @ApiPropertyOptional({ description: 'Instructions pour le livreur' })
  @IsOptional()
  @IsString()
  deliveryNotes?: string;

  @ApiPropertyOptional({ description: 'Motif d\'échec' })
  @IsOptional()
  @IsString()
  failReason?: string;

  @ApiPropertyOptional({ description: 'Frais de livraison en FCFA' })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

export class AddParcelPhotosDto {
  @ApiProperty({ description: 'Photos base64 (max 2)', type: [String] })
  @IsString({ each: true })
  @ArrayMaxSize(2)
  photos: string[];
}

export class ParcelFiltersDto {
  @IsOptional()
  @IsString()
  tripId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  date?: string; // YYYY-MM-DD
}
