import { IsString, IsInt, IsBoolean, IsOptional, Min, IsNotEmpty } from 'class-validator';

export class CreateSmsPackageDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsInt() @Min(1)
  smsCount: number;

  @IsInt() @Min(0)
  priceXof: number;

  @IsBoolean() @IsOptional()
  hasCustomSender?: boolean;

  @IsInt() @IsOptional()
  sortOrder?: number;
}

export class UpdateSmsPackageDto {
  @IsString() @IsOptional()
  name?: string;

  @IsInt() @Min(1) @IsOptional()
  smsCount?: number;

  @IsInt() @Min(0) @IsOptional()
  priceXof?: number;

  @IsBoolean() @IsOptional()
  hasCustomSender?: boolean;

  @IsBoolean() @IsOptional()
  isActive?: boolean;

  @IsInt() @IsOptional()
  sortOrder?: number;
}

export class PurchaseSmsPackageDto {
  @IsString() @IsNotEmpty()
  packageId: string;

  @IsString() @IsOptional()
  customSender?: string;
}
