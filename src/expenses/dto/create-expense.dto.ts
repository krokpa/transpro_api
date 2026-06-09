import {
  IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory } from '@transpro/shared';

export class CreateExpenseDto {
  @ApiProperty({ description: 'ID de la gare' })
  @IsUUID()
  stationId: string;

  @ApiProperty({ enum: ExpenseCategory })
  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @ApiProperty({ example: 'Achat gasoil groupe électrogène' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description: string;

  @ApiProperty({ example: 25000, description: 'Montant en XOF' })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ example: '2026-06-09', description: 'Date de la dépense (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ example: 'Reçu #1234 — Total Energies' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  receiptNote?: string;
}
