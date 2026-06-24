import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformSettingsService } from './platform-settings.service';
import { UpdatePlatformSettingsDto } from './dto/platform-settings.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Réglages plateforme')
@Controller({ path: 'platform-settings', version: '1' })
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Réglages de marque (public — nom, couleur, logo)' })
  get() {
    return this.settings.get();
  }

  @Patch()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Modifier la marque (admin)' })
  update(@Body() dto: UpdatePlatformSettingsDto) {
    return this.settings.update(dto);
  }
}
