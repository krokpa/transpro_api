import { IsString, IsOptional, IsBoolean, IsEnum, IsArray } from 'class-validator';
import { PaperSize } from '@transpro/shared';

export class CreateTicketTemplateDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PaperSize)
  paperSize?: PaperSize;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsArray()
  layout?: any[];
}

export class UpdateTicketTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PaperSize)
  paperSize?: PaperSize;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsArray()
  layout?: any[];
}
