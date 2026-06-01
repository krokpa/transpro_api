import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@transpro/shared';
import { UpsertCampaignConfigDto } from './dto/campaign-config.dto';

@ApiTags('Notifications')
@Controller({ path: 'notifications', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get('my')
  @ApiOperation({ summary: 'Récupérer mes notifications' })
  @ApiQuery({ name: 'onlyUnread', required: false, type: Boolean })
  findMy(
    @CurrentUser('id') userId: string,
    @Query('onlyUnread') onlyUnread?: string,
  ) {
    return this.notificationsService.findByUser(userId, onlyUnread === 'true');
  }

  @Get('my/count')
  @ApiOperation({ summary: 'Nombre de notifications non lues' })
  getUnreadCount(@CurrentUser('id') userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  markAsRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.markAsRead(id, userId);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marquer toutes les notifications comme lues' })
  markAllAsRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  // ── Campaign config ──────────────────────────────────────────────────────────

  @Get('campaigns/config')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Récupérer la config campagnes de ma compagnie' })
  getCampaignConfig(@CurrentUser('id') userId: string) {
    return this.notificationsService.getCampaignConfigByUserId(userId);
  }

  @Put('campaigns/config')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Mettre à jour la config campagnes de ma compagnie' })
  upsertCampaignConfig(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertCampaignConfigDto,
  ) {
    return this.notificationsService.upsertCampaignConfig(userId, dto);
  }

  @Get('campaigns/config/tenant/:tenantId')
  @ApiOperation({ summary: 'Config campagnes publique d\'une compagnie (passagers)' })
  getPublicCampaignConfig(@Param('tenantId') tenantId: string) {
    return this.notificationsService.getCampaignConfig(tenantId);
  }
}
