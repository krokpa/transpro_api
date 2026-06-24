import { Module } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSettingsController } from './platform-settings.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PlatformSettingsService],
  controllers: [PlatformSettingsController],
})
export class PlatformSettingsModule {}
