import { Global, Module } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSettingsController } from './platform-settings.controller';
import { PrismaModule } from '../prisma/prisma.module';

// Global : la marque (BrandService) doit être injectable partout (emails, SMS, auth…).
@Global()
@Module({
  imports: [PrismaModule],
  providers: [PlatformSettingsService],
  controllers: [PlatformSettingsController],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
