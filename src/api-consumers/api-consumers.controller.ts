import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus,
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
@Roles(UserRole.SUPER_ADMIN, UserRole.COMPANY_OWNER)
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
  ) {
    return this.service.createConsumer(dto, role, tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les consommateurs API' })
  findAll(
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.findAllConsumers(role, tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détails d\'un consommateur + ses clés' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.findOneConsumer(id, role, tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un consommateur (plan, statut, IP…)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateApiConsumerDto,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.updateConsumer(id, dto, role, tenantId);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Statistiques d\'usage mensuel d\'un consommateur' })
  usage(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.getUsageStats(id, role, tenantId);
  }

  @Get(':id/webhooks')
  @ApiOperation({ summary: 'Dernières livraisons de webhooks d\'un consommateur' })
  webhookDeliveries(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.listWebhookDeliveries(id, role, tenantId);
  }

  // ── Clés API ───────────────────────────────────────────────────────────────

  @Post(':id/keys')
  @ApiOperation({ summary: 'Générer une nouvelle clé API pour ce consommateur' })
  createKey(
    @Param('id') consumerId: string,
    @Body() dto: CreateApiKeyDto,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.createKey(consumerId, dto, role, tenantId);
  }

  @Delete(':id/keys/:keyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Révoquer une clé API' })
  revokeKey(
    @Param('id') consumerId: string,
    @Param('keyId') keyId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.revokeKey(consumerId, keyId, role, tenantId);
  }
}
