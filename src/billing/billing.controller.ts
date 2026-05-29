import {
  Controller, Post, Patch, Get, Body, Param,
  UseGuards, Headers, Req, RawBodyRequest, HttpCode, HttpStatus,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserRole, TenantPlan } from '@transpro/shared';
import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class SubscribeDto {
  @ApiProperty({ enum: TenantPlan })
  @IsEnum(TenantPlan)
  plan: TenantPlan;
}

@ApiTags('Facturation')
@Controller({ path: 'billing', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class BillingController {
  constructor(private billing: BillingService) {}

  // ── Paiement abonnement ────────────────────────────────────────────────────

  @Post('subscribe')
  @Roles(UserRole.COMPANY_OWNER)
  @ApiOperation({ summary: 'Initier le paiement d\'un abonnement via Genius Pay' })
  subscribe(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: SubscribeDto,
  ) {
    return this.billing.initiateSubscriptionPayment(tenantId, dto.plan);
  }

  @Patch('subscriptions/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.COMPANY_OWNER)
  @ApiOperation({ summary: 'Confirmer le paiement depuis la page de redirection' })
  confirmFromRedirect(
    @Param('id') subscriptionId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.billing.confirmFromRedirect(subscriptionId, tenantId);
  }

  // ── Webhook Genius Pay ────────────────────────────────────────────────────

  @Public()
  @Post('webhook/subscription')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook Genius Pay — confirmation paiement abonnement' })
  async subscriptionWebhook(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('x-genius-signature') signature: string,
    @Headers('x-genius-timestamp') timestamp: string,
  ) {
    const rawBody = (req.rawBody as Buffer)?.toString('utf8') ?? JSON.stringify(req.body);
    return this.billing.handleSubscriptionWebhook(rawBody, signature, timestamp);
  }

  // ── Super Admin ──────────────────────────────────────────────────────────

  @Post('run-check')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Déclencher manuellement la vérification des abonnements' })
  runCheck() {
    return this.billing.runNow();
  }
}
