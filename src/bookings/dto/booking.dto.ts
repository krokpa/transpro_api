import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@transpro/shared';

export class CreateBookingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiProperty({ example: ['1A', '1B'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  seatNumbers: string[];
}

export class CreateGuichetBookingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiProperty({ example: ['1A', '1B'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  seatNumbers: string[];

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
