import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePlatformSettingsDto } from './dto/platform-settings.dto';

const SINGLETON_ID = 'singleton';
const BRAND_TTL_MS = 60_000;

/** Identité de marque résolue côté serveur (settings + env). Source unique white-label. */
export interface Brand {
  appName: string;
  tagline: string;
  primaryColor: string;
  logoUrl: string | null;
  /** Adresse d'expéditeur des emails, ex. "noreply@acme.com". */
  emailFrom: string;
  /** Domaine de marque, ex. "acme.com" (emails synthétiques, liens). */
  domain: string;
}

@Injectable()
export class PlatformSettingsService {
  private brandCache: { value: Brand; at: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /** Renvoie les réglages plateforme (crée la ligne par défaut si absente). */
  async get() {
    return this.prisma.platformSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
  }

  async update(dto: UpdatePlatformSettingsDto) {
    this.brandCache = null; // invalide le cache marque
    return this.prisma.platformSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...dto },
      update: { ...dto },
    });
  }

  /**
   * Marque résolue (mise en cache 60 s) — à utiliser partout côté serveur
   * (emails, SMS, 2FA, métadonnées). Le nom/logo/couleur viennent de
   * PlatformSettings ; le domaine et l'expéditeur viennent de l'env (white-label).
   */
  async getBrand(): Promise<Brand> {
    if (this.brandCache && Date.now() - this.brandCache.at < BRAND_TTL_MS) {
      return this.brandCache.value;
    }
    const s = await this.get();
    const domain = this.config.get<string>('APP_DOMAIN', 'transpro.ci');
    const value: Brand = {
      appName:      s.appName,
      tagline:      s.tagline,
      primaryColor: s.primaryColor,
      logoUrl:      s.logoUrl,
      emailFrom:    this.config.get<string>('MAIL_FROM', `noreply@${domain}`),
      domain,
    };
    this.brandCache = { value, at: Date.now() };
    return value;
  }
}
