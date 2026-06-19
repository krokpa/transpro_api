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

  @ApiPropertyOptional({ description: 'Photo de profil en base64 (data URL)' })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ example: 'orange', enum: ['orange', 'blue', 'purple', 'green', 'rose', 'teal'] })
  @IsOptional()
  @IsString()
  themeAccent?: string;

  @ApiPropertyOptional({ example: 'navy', enum: ['navy', 'slate', 'charcoal'] })
  @IsOptional()
  @IsString()
  themeSidebar?: string;

  @ApiPropertyOptional({ example: 'system', enum: ['light', 'dark', 'system'] })
  @IsOptional()
  @IsString()
  themeColorMode?: string;
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

export class SetCredentialsDto {
  @ApiPropertyOptional({ example: 'krokpa@email.com', description: 'Nouvelle adresse email (remplace l\'adresse guichet générée automatiquement)' })
  @IsOptional()
  @IsEmail({}, { message: 'Email invalide' })
  email?: string;

  @ApiPropertyOptional({ minLength: 8, description: 'Mot de passe à définir (minimum 8 caractères)' })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères' })
  password?: string;
}
