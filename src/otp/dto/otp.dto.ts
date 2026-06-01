import { IsString, Matches, Length } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: 'Numéro au format international requis (+225XXXXXXXXXX)' })
  phone: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: 'Numéro au format international requis' })
  phone: string;

  @IsString()
  @Length(6, 6, { message: 'Le code OTP doit contenir 6 chiffres' })
  @Matches(/^\d{6}$/, { message: 'Code invalide' })
  code: string;
}
