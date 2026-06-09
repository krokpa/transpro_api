import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectProvisionDto {
  @ApiProperty({ example: 'Solde insuffisant ce mois — reporter à la semaine prochaine' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
