import {
  IsEmail, IsEnum, IsOptional, IsString, IsArray,
  IsUrl, MaxLength, IsIn,
} from 'class-validator';
import { ApiPlan, ApiConsumerStatus, SCOPE, ApiScope } from '@transpro/shared';

export class CreateApiConsumerDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  companyName?: string;

  @IsOptional()
  @IsEnum(ApiPlan)
  plan?: ApiPlan;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedIps?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateApiConsumerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(ApiPlan)
  plan?: ApiPlan;

  @IsOptional()
  @IsEnum(ApiConsumerStatus)
  status?: ApiConsumerStatus;

  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedIps?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(SCOPE), { each: true })
  scopes?: ApiScope[];

  @IsOptional()
  expiresAt?: Date;
}
