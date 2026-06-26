import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendTicketSmsDto {
  @ApiProperty({ example: '+2250700000000', description: 'Numéro du passager (format international)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  phone!: string;
}
