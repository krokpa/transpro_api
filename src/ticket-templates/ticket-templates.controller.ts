import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TicketTemplatesService } from './ticket-templates.service';
import { CreateTicketTemplateDto, UpdateTicketTemplateDto } from './dto/ticket-template.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Modèles de tickets')
@Controller({ path: 'ticket-templates', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class TicketTemplatesController {
  constructor(private service: TicketTemplatesService) {}

  @Post()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Créer un modèle' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateTicketTemplateDto) {
    return this.service.create(tenantId, dto);
  }

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

  @Patch(':id')
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
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Définir comme modèle par défaut' })
  setDefault(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.setDefault(tenantId, id);
  }

  @Post(':id/duplicate')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Dupliquer un modèle' })
  duplicate(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.duplicate(tenantId, id);
  }

  @Delete(':id')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer un modèle' })
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}
