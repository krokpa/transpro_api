import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TicketTemplatesService } from './ticket-templates.service';
import { CreateTicketTemplateDto, UpdateTicketTemplateDto } from './dto/ticket-template.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard, RequiresPlan } from '../common/guards/plan.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole, TenantPlan } from '@transpro/shared';

@ApiTags('Modèles de tickets')
@Controller({ path: 'ticket-templates', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class TicketTemplatesController {
  constructor(private service: TicketTemplatesService) {}

  // Lecture : tous les plans (le template par défaut est créé pour toutes les compagnies)
  @Get()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Lister les modèles' })
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Get('default')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Modèle par défaut' })
  findDefault(@CurrentUser('tenantId') tenantId: string) {
    return this.service.findDefault(tenantId);
  }

  @Get(':id')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Obtenir un modèle' })
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id);
  }

  // Écriture : plan PROFESSIONAL ou ENTERPRISE requis
  @Post()
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Créer un modèle' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateTicketTemplateDto) {
    return this.service.create(tenantId, dto);
  }

  @Patch(':id')
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Mettre à jour un modèle' })
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTicketTemplateDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Patch(':id/set-default')
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Définir comme modèle par défaut' })
  setDefault(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.setDefault(tenantId, id);
  }

  @Post(':id/duplicate')
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Dupliquer un modèle' })
  duplicate(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.duplicate(tenantId, id);
  }

  @Delete(':id')
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer un modèle' })
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}
