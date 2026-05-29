import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ArrayMaxSize, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@transpro/shared';

export class CreateBookingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiPropertyOptional({ example: ['1A', '1B'], description: 'Requis si gestion avancée des sièges activée' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  seatNumbers?: string[];

  @ApiPropertyOptional({ example: 2, description: 'Nombre de sièges si gestion avancée désactivée' })
  @IsOptional()
  @IsInt()
  @Min(1)
  passengerCount?: number;
}

export class CreateGuichetBookingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiPropertyOptional({ example: ['1A', '1B'], description: 'Requis si gestion avancée des sièges activée' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  seatNumbers?: string[];

  @ApiPropertyOptional({ example: 2, description: 'Nombre de sièges si gestion avancée désactivée' })
  @IsOptional()
  @IsInt()
  @Min(1)
  passengerCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: '+2250712345678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stationId?: string;
}

export class InitiatePaymentDto {
  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ example: '+2250712345678' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
