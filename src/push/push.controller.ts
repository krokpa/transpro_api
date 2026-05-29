import {
  Controller, Get, Post, Delete, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PushService, WebPushSubscribeDto } from './push.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PlanGuard, RequiresPlan } from '../common/guards/plan.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { TenantPlan } from '@transpro/shared';

@ApiTags('Push Notifications')
@Controller({ path: 'push', version: '1' })
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private push: PushService) {}

  @Public()
  @Get('vapid-key')
  @ApiOperation({ summary: 'Clé publique VAPID pour l\'enregistrement du Service Worker' })
  vapidKey() {
    return { publicKey: this.push.getVapidPublicKey() };
  }

  @Post('web-subscribe')
  @ApiBearerAuth()
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Enregistrer un abonnement Web Push — PROFESSIONAL+ (dashboard staff)' })
  subscribe(@CurrentUser('id') userId: string, @Body() dto: WebPushSubscribeDto) {
    return this.push.subscribe(userId, dto);
  }

  @Delete('web-unsubscribe')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un abonnement Web Push' })
  unsubscribe(
    @CurrentUser('id') userId: string,
    @Body('endpoint') endpoint: string,
  ) {
    return this.push.unsubscribe(userId, endpoint);
  }
}
