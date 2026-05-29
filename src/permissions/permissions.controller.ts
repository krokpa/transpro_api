import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { CreateProfileDto, UpdateProfileDto, AssignCompanyProfileDto, AssignStationProfileDto } from './dto/permission.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard, RequiresPlan } from '../common/guards/plan.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole, TenantPlan } from '@transpro/shared';

@ApiTags('Permissions & Profils')
@Controller({ path: 'permissions', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class PermissionsController {
  constructor(private perms: PermissionsService) {}

  // ─── Référentiel ──────────────────────────────────────────────────────────

  @Get('codes')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Liste toutes les permissions disponibles' })
  listPermissions() {
    return this.perms.listPermissions();
  }

  @Get('profiles/system')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Liste les profils système (non modifiables)' })
  systemProfiles() {
    return this.perms.listSystemProfiles();
  }

  // ─── Profils du tenant ───────────────────────────────────────────────────

  @Get('profiles')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Liste les profils du tenant (système + custom)' })
  listProfiles(@CurrentUser('tenantId') tenantId: string) {
    return this.perms.listProfiles(tenantId);
  }

  @Get('profiles/:id')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Détail d\'un profil' })
  getProfile(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.perms.getProfile(id, tenantId);
  }

  @Post('profiles')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Créer un profil custom (ENTERPRISE)' })
  createProfile(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateProfileDto) {
    return this.perms.createProfile(tenantId, dto);
  }

  @Patch('profiles/:id')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Modifier un profil custom (ENTERPRISE)' })
  updateProfile(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.perms.updateProfile(id, tenantId, dto);
  }

  @Delete('profiles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.COMPANY_OWNER)
  @ApiOperation({ summary: 'Supprimer un profil custom' })
  deleteProfile(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.perms.deleteProfile(id, tenantId);
  }

  // ─── Assignation ────────────────────────────────────────────────────────

  @Post('assign/company')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Assigner un profil compagnie à un utilisateur' })
  assignCompany(@CurrentUser('tenantId') tenantId: string, @Body() dto: AssignCompanyProfileDto) {
    return this.perms.assignCompanyProfile(tenantId, dto);
  }

  @Post('assign/station')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Assigner un profil gare à un utilisateur pour une gare donnée' })
  assignStation(@CurrentUser('tenantId') tenantId: string, @Body() dto: AssignStationProfileDto) {
    return this.perms.assignStationProfile(tenantId, dto);
  }

  @Delete('assign/company/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Retirer le profil compagnie d\'un utilisateur' })
  removeCompanyProfile(@CurrentUser('tenantId') tenantId: string, @Param('userId') userId: string) {
    return this.perms.removeCompanyProfile(tenantId, userId);
  }
}
