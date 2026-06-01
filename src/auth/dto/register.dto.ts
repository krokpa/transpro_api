import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsEnum, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@transpro/shared';

export class RegisterDto {
  @ApiProperty({ example: 'Kouassi' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Yves' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'yves@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+2250712345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[\d\s\-().]{7,20}$/, { message: 'Format de téléphone invalide' })
  phone: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: UserRole, default: UserRole.PASSENGER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({ description: 'Token JWT retourné par POST /v1/otp/verify' })
  @IsString()
  @IsNotEmpty()
  phoneVerificationToken: string;
}

export class LoginDto {
  @ApiProperty({ example: 'yves@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
