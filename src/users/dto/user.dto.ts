import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@transpro/shared';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Kouassi' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Yao' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: '+2250700000001' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'fr', enum: ['fr', 'en'] })
  @IsOptional()
  @IsString()
  preferredLang?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  newPassword: string;
}

export class AddToTenantDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

export class InviteTeamMemberDto {
  @ApiProperty({ example: 'Kouassi' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Yao' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'agent@compagnie.ci' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: '+2250700000001' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: [UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT] })
  @IsEnum(UserRole)
  role: UserRole;
}

export class UpdateRoleDto {
  @ApiProperty({ enum: [UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT] })
  @IsEnum(UserRole)
  role: UserRole;
}
