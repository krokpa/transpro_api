import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitBankDetailsDto {
  @ApiProperty({ example: 'Ecobank Côte d\'Ivoire' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  bankName: string;

  @ApiProperty({ example: 'CI001234567890123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  bankAccount: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
