import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePlatformSettingsDto } from './dto/platform-settings.dto';

const SINGLETON_ID = 'singleton';

@Injectable()
export class PlatformSettingsService {
  constructor(private prisma: PrismaService) {}

  /** Renvoie les réglages plateforme (crée la ligne par défaut si absente). */
  async get() {
    return this.prisma.platformSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
  }

  async update(dto: UpdatePlatformSettingsDto) {
    return this.prisma.platformSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...dto },
      update: { ...dto },
    });
  }
}
