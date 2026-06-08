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

export class LoginByPhoneDto {
  @ApiProperty({ example: '+2250712345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+\d{10,15}$/, { message: 'Format international requis : +225XXXXXXXXXX' })
  phone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Le code OTP doit être à 6 chiffres' })
  code: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class SocialAuthDto {
  @ApiProperty({ enum: ['google', 'facebook'] })
  @IsEnum(['google', 'facebook'])
  provider: 'google' | 'facebook';

  @ApiProperty({ description: "ID token (Google) ou access token (Facebook)" })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
