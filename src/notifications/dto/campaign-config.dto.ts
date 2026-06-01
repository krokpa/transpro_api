import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEFAULT_CAMPAIGN_CONFIG = {
  morningReminderEnabled: false,
  morningReminderHour: 7,
  morningReminderMinute: 30,
  morningReminderTitle: 'Bonjour !',
  morningReminderBody: 'Planifiez votre prochain voyage avec TransPro.',
  weekendOfferEnabled: false,
  weekendOfferHour: 18,
  weekendOfferMinute: 0,
  weekendOfferTitle: 'Bon week-end !',
  weekendOfferBody:
    'Voyagez en famille ce week-end. Réservez vos places maintenant.',
  reEngagementEnabled: false,
  reEngagementAfterDays: 7,
  reEngagementTitle: 'On vous attend !',
  reEngagementBody: 'Ça fait un moment ! Où voyagez-vous cette semaine ?',
} as const;

export type CampaignConfig = typeof DEFAULT_CAMPAIGN_CONFIG;

export class UpsertCampaignConfigDto {
  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  morningReminderEnabled?: boolean;

  @ApiPropertyOptional({ default: 7, minimum: 0, maximum: 23 })
  @IsInt()
  @Min(0)
  @Max(23)
  @IsOptional()
  morningReminderHour?: number;

  @ApiPropertyOptional({ default: 30, minimum: 0, maximum: 59 })
  @IsInt()
  @Min(0)
  @Max(59)
  @IsOptional()
  morningReminderMinute?: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  @IsOptional()
  morningReminderTitle?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  morningReminderBody?: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  weekendOfferEnabled?: boolean;

  @ApiPropertyOptional({ default: 18, minimum: 0, maximum: 23 })
  @IsInt()
  @Min(0)
  @Max(23)
  @IsOptional()
  weekendOfferHour?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 59 })
  @IsInt()
  @Min(0)
  @Max(59)
  @IsOptional()
  weekendOfferMinute?: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  @IsOptional()
  weekendOfferTitle?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  weekendOfferBody?: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  reEngagementEnabled?: boolean;

  @ApiPropertyOptional({ default: 7, minimum: 3, maximum: 30 })
  @IsInt()
  @Min(3)
  @Max(30)
  @IsOptional()
  reEngagementAfterDays?: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  @IsOptional()
  reEngagementTitle?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  reEngagementBody?: string;
}
