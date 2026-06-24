import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ApiConsumersService } from './api-consumers.service';
import {
  CreateApiConsumerDto,
  UpdateApiConsumerDto,
  CreateApiKeyDto,
} from './dto/api-consumer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('API Publique — Gestion')
@Controller({ path: 'api-consumers', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COMPANY_OWNER, UserRole.DEVELOPER)
@ApiBearerAuth()
export class ApiConsumersController {
  constructor(private service: ApiConsumersService) {}

  // ── Consumers ──────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Créer un consommateur API externe' })
  create(
    @Body() dto: CreateApiConsumerDto,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.createConsumer(dto, role, tenantId, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les consommateurs API' })
  findAll(
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.findAllConsumers(role, tenantId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détails d\'un consommateur + ses clés' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.findOneConsumer(id, role, tenantId, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un consommateur (plan, statut, IP…)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateApiConsumerDto,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.updateConsumer(id, dto, role, tenantId, userId);
  }

  @Post(':id/request-production')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demander l\'activation de l\'accès production (clés LIVE)' })
  requestProduction(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.requestProduction(id, role, tenantId, userId);
  }

  @Post(':id/review-production')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approuver/rejeter une demande d\'activation production (admin)' })
  reviewProduction(
    @Param('id') id: string,
    @Body() dto: { approve: boolean; reason?: string },
    @CurrentUser('role') role: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.reviewProduction(id, dto.approve, role, dto.reason, userId);
  }

  @Post(':id/billing/subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Souscrire/changer le plan (Genius Pay pour les plans payants)' })
  subscribePlan(
    @Param('id') id: string,
    @Body() dto: { plan: string },
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.subscribePlan(id, dto.plan, role, tenantId, userId);
  }

  @Post(':id/billing/confirm/:paymentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmer un paiement de plan depuis la redirection' })
  confirmPlan(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.confirmPlanFromRedirect(id, paymentId, role, tenantId, userId);
  }

  @Get(':id/billing/invoices')
  @ApiOperation({ summary: 'Historique des factures (paiements de plan)' })
  invoices(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.listInvoices(id, role, tenantId, userId);
  }

  @Get(':id/billing/invoices/:paymentId/pdf')
  @ApiOperation({ summary: 'Télécharger la facture PDF d\'un paiement' })
  async invoicePdf(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
    @Res() reply: any,
  ) {
    const { buffer, filename, mimetype } = await this.service.getInvoicePdf(id, paymentId, role, tenantId, userId);
    reply.header('Content-Type', mimetype);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.send(buffer);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Statistiques d\'usage mensuel d\'un consommateur' })
  usage(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.getUsageStats(id, role, tenantId, userId);
  }

  @Post(':id/webhooks/:deliveryId/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Relancer une livraison de webhook' })
  resendWebhook(
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.resendWebhook(id, deliveryId, role, tenantId, userId);
  }

  @Get(':id/webhooks')
  @ApiOperation({ summary: 'Dernières livraisons de webhooks d\'un consommateur' })
  webhookDeliveries(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.listWebhookDeliveries(id, role, tenantId, userId);
  }

  // ── Clés API ───────────────────────────────────────────────────────────────

  @Post(':id/keys')
  @ApiOperation({ summary: 'Générer une nouvelle clé API pour ce consommateur' })
  createKey(
    @Param('id') consumerId: string,
    @Body() dto: CreateApiKeyDto,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.createKey(consumerId, dto, role, tenantId, userId);
  }

  @Post(':id/keys/:keyId/rotate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Faire tourner une clé (ancienne valable 24 h)' })
  rotateKey(
    @Param('id') consumerId: string,
    @Param('keyId') keyId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.rotateKey(consumerId, keyId, role, tenantId, userId);
  }

  @Delete(':id/keys/:keyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Révoquer une clé API' })
  revokeKey(
    @Param('id') consumerId: string,
    @Param('keyId') keyId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.revokeKey(consumerId, keyId, role, tenantId, userId);
  }

  @Post(':id/regenerate-webhook-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Régénérer le secret de signature webhook' })
  regenerateWebhookSecret(
    @Param('id') consumerId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.regenerateWebhookSecret(consumerId, role, tenantId, userId);
  }
}
