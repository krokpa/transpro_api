import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { PlanLimitsService } from '../common/plan-limits.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole, TenantPlan } from '@transpro/shared';
import { Public } from '../common/decorators/public.decorator';
import { PlanGuard, RequiresPlan } from '../common/guards/plan.guard';

@ApiTags('Tenants / Compagnies')
@Controller({ path: 'tenants', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantsController {
  constructor(
    private tenantsService: TenantsService,
    private planLimitsService: PlanLimitsService,
  ) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Lister les compagnies actives (public)' })
  findPublic() {
    return this.tenantsService.findPublic();
  }

  @Public()
  @Get('slug/:slug')
  @ApiOperation({ summary: 'Profil public d\'une compagnie par slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.tenantsService.findPublicProfile(slug);
  }

  @Post()
  @ApiBearerAuth()
  @Roles(UserRole.SUPER_ADMIN, UserRole.PASSENGER)
  @ApiOperation({ summary: 'Créer une compagnie (Super Admin ou passager qui s\'inscrit)' })
  create(@Body() dto: CreateTenantDto, @CurrentUser('id') userId: string) {
    return this.tenantsService.create(dto, userId);
  }

  @Get()
  @ApiBearerAuth()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Lister toutes les compagnies (Super Admin)' })
  findAll() {
    return this.tenantsService.findAll();
  }

  @Get('me')
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Détails de la compagnie courante' })
  findMe(@CurrentUser('tenantId') tenantId: string) {
    return this.tenantsService.findOne(tenantId);
  }

  @Patch('me')
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Mettre à jour la compagnie courante' })
  updateMe(@CurrentUser('tenantId') tenantId: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(tenantId, dto);
  }

  @Get('me/stats')
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Statistiques de la compagnie courante' })
  getStats(@CurrentUser('tenantId') tenantId: string) {
    return this.tenantsService.getStats(tenantId);
  }

  @Get('me/subscriptions')
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Historique des abonnements' })
  getSubscriptions(@CurrentUser('tenantId') tenantId: string) {
    return this.tenantsService.getSubscriptionHistory(tenantId);
  }

  @Get(':id')
  @ApiBearerAuth()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Détails d\'une compagnie (Super Admin)' })
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Modifier statut/plan d\'une compagnie (Super Admin)' })
  updateById(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Get(':id/full-detail')
  @ApiBearerAuth()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Détail complet d\'un tenant pour le super admin' })
  getTenantFullDetail(@Param('id') id: string) {
    return this.tenantsService.getTenantFullDetail(id);
  }

  // ─── Super Admin — Stats & Users ─────────────────────────────────────────

  @Get('admin/platform-stats')
  @ApiBearerAuth()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'KPIs globaux plateforme (Super Admin)' })
  platformStats() {
    return this.tenantsService.getPlatformStats();
  }

  @Get('admin/users')
  @ApiBearerAuth()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Tous les utilisateurs du système (Super Admin)' })
  allUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    return this.tenantsService.getAllUsers(page, Math.min(limit, 100), search, role);
  }

  @Get('me/usage')
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Utilisation des ressources vs limites du plan' })
  getUsage(@CurrentUser('tenantId') tenantId: string) {
    return this.planLimitsService.getUsage(tenantId);
  }

  @Get('me/analytics')
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Analytiques détaillées — PROFESSIONAL+ (revenus, routes, tendances)' })
  getAnalytics(
    @CurrentUser('tenantId') tenantId: string,
    @Query('period') period?: string,
  ) {
    return this.tenantsService.getAnalytics(tenantId, period);
  }
}
