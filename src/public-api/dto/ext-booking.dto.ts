import {
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExtBookingDto {
  @ApiProperty({ description: 'Identifiant du voyage' })
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiProperty({ example: '+2250700000000' })
  @IsString()
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'passengerPhone doit être un numéro valide (8 à 15 chiffres).' })
  passengerPhone: string;

  @ApiProperty({ example: 'Awa Koné' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  passengerName: string;

  @ApiPropertyOptional({ example: 'awa@example.com' })
  @IsOptional()
  @IsEmail()
  passengerEmail?: string;

  @ApiProperty({ type: [String], example: ['A1', 'A2'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  seatNumbers: string[];
}
