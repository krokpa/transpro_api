import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExtParcelDto {
  @ApiProperty({ description: 'Identifiant du voyage qui transporte le colis' })
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiProperty({ example: 'Awa Koné' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  senderName: string;

  @ApiProperty({ example: '+2250700000000' })
  @IsString()
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'senderPhone doit être un numéro valide (8 à 15 chiffres).' })
  senderPhone: string;

  @ApiPropertyOptional({ example: 'awa@example.com' })
  @IsOptional()
  @IsEmail()
  senderEmail?: string;

  @ApiProperty({ example: 'Yao Kouassi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  recipientName: string;

  @ApiProperty({ example: '+2250500000000' })
  @IsString()
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'recipientPhone doit être un numéro valide (8 à 15 chiffres).' })
  recipientPhone: string;

  @ApiPropertyOptional({ example: 'yao@example.com' })
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiProperty({ example: 'Bouaké' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  deliveryCity: string;

  @ApiProperty({ example: 'Documents administratifs' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(280)
  description: string;

  @ApiProperty({ example: 2.5, description: 'Poids en kg (max 50)' })
  @IsNumber()
  @Min(0.1)
  @Max(50)
  weightKg: number;

  @ApiPropertyOptional({ example: 50000, description: 'Valeur déclarée en FCFA' })
  @IsOptional()
  @IsInt()
  @Min(0)
  declaredValue?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  fragile?: boolean;
}
