import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectExpenseDto {
  @ApiProperty({ example: 'Reçu manquant ou illisible' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
