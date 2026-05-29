import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Res, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StationsService } from './stations.service';
import { ReportsService } from '../reports/reports.service';
import { CreateStationDto, UpdateStationDto, AssignMemberDto } from './dto/station.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PERM, UserRole } from '@transpro/shared';

@ApiTags('Gares')
@Controller({ path: 'stations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class StationsController {
  constructor(
    private stations: StationsService,
    private reports: ReportsService,
  ) {}

  /** Vérifie qu'un agent n'accède qu'à ses gares assignées. */
  private assertStationAccess(user: any, stationId: string) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (user.role === UserRole.COMPANY_OWNER || user.role === UserRole.COMPANY_ADMIN) return;
    // COMPANY_AGENT : doit être assigné à la gare
    const assigned: string[] = user.stationIds ?? (user.stationId ? [user.stationId] : []);
    if (!assigned.includes(stationId)) {
      throw new ForbiddenException('Accès refusé : vous n\'êtes pas affecté à cette gare');
    }
  }

  @Public()
  @Get('by-city')
  @ApiOperation({ summary: 'Lister les gares actives d\'une ville (public)' })
  findByCity(@Query('city') city: string) {
    return this.stations.findByCity(city ?? '');
  }

  @Public()
  @Get(':id/info')
  @ApiOperation({ summary: 'Détails publics d\'une gare (passagers)' })
  findPublicInfo(@Param('id') id: string) {
    return this.stations.findPublicInfo(id);
  }

  @Post()
  @RequirePermission(PERM.STATIONS_MANAGE)
  @ApiOperation({ summary: 'Créer une gare' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateStationDto) {
    return this.stations.create(tenantId, dto);
  }

  @Get()
  @RequirePermission(PERM.TRIPS_VIEW)
  @ApiOperation({ summary: 'Lister les gares' })
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.stations.findAll(tenantId);
  }

  @Get(':id')
  @RequirePermission(PERM.TRIPS_VIEW)
  @ApiOperation({ summary: 'Détails d\'une gare' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.stations.findOne(id, tenantId);
  }

  @Patch(':id')
  @RequirePermission(PERM.STATIONS_MANAGE)
  @ApiOperation({ summary: 'Modifier une gare' })
  update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateStationDto,
  ) {
    return this.stations.update(id, tenantId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.COMPANY_OWNER)
  @RequirePermission(PERM.STATIONS_MANAGE)
  @ApiOperation({ summary: 'Supprimer une gare' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.stations.remove(id, tenantId);
  }

  // ── Members ──────────────────────────────────────────────────────────────

  @Get(':id/members')
  @RequirePermission(PERM.TEAM_VIEW)
  @ApiOperation({ summary: 'Membres affectés à la gare' })
  getMembers(@Param('id') id: string, @CurrentUser() user: any) {
    this.assertStationAccess(user, id);
    return this.stations.getMembers(id, user.tenantId);
  }

  @Post(':id/members')
  @RequirePermission(PERM.TEAM_MANAGE)
  @ApiOperation({ summary: 'Affecter un agent à la gare' })
  assignMember(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: AssignMemberDto,
  ) {
    return this.stations.assignMember(id, tenantId, dto);
  }

  @Delete(':id/members/:userId')
  @RequirePermission(PERM.TEAM_MANAGE)
  @ApiOperation({ summary: 'Retirer un agent de la gare' })
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.stations.removeMember(id, userId, tenantId);
  }

  // ── Station workspace ─────────────────────────────────────────────────────

  @Get(':id/dashboard')
  @RequirePermission(PERM.TRIPS_VIEW)
  @ApiOperation({ summary: 'Tableau de bord de la gare (stats du jour)' })
  getDashboard(@Param('id') id: string, @CurrentUser() user: any) {
    this.assertStationAccess(user, id);
    return this.stations.getDashboard(id, user.tenantId);
  }

  @Get(':id/trips')
  @RequirePermission(PERM.TRIPS_VIEW)
  @ApiOperation({ summary: 'Voyages au départ de la gare (jour courant ou date précisée)' })
  getTodayTrips(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('date') date?: string,
  ) {
    this.assertStationAccess(user, id);
    return this.stations.getTodayTrips(id, user.tenantId, date);
  }

  @Get(':id/bookings')
  @RequirePermission(PERM.BOOKINGS_VIEW)
  @ApiOperation({ summary: 'Réservations vendues par la gare' })
  getBookings(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    this.assertStationAccess(user, id);
    return this.stations.getBookings(id, user.tenantId, {
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @Get(':id/caisse')
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Caisse de la gare' })
  getCaisse(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('date') date?: string,
  ) {
    this.assertStationAccess(user, id);
    return this.stations.getCaisse(id, user.tenantId, date);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  @Get(':id/analytics')
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Analytiques de la gare (30 derniers jours par défaut)' })
  getAnalytics(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('days') days?: string,
  ) {
    this.assertStationAccess(user, id);
    return this.stations.getAnalytics(id, user.tenantId, days ? parseInt(days, 10) : 30);
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  @Get(':id/reports/daily-sales')
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Rapport ventes journalières de la gare (PDF/CSV)' })
  async reportDailySales(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('date') date: string,
    @Query('format') format: 'pdf' | 'csv' = 'pdf',
    @Res() reply: any,
  ) {
    this.assertStationAccess(user, id);
    const out = await this.reports.stationDailySales(id, user.tenantId, date, format);
    reply.header('Content-Type', out.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${out.filename}"`);
    reply.send(out.buffer);
  }

  @Get(':id/reports/weekly-summary')
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Bilan hebdomadaire de la gare (PDF/CSV)' })
  async reportWeeklySummary(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('weekStart') weekStart: string,
    @Query('format') format: 'pdf' | 'csv' = 'pdf',
    @Res() reply: any,
  ) {
    this.assertStationAccess(user, id);
    const out = await this.reports.stationWeeklySummary(id, user.tenantId, weekStart, format);
    reply.header('Content-Type', out.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${out.filename}"`);
    reply.send(out.buffer);
  }

  @Get(':id/reports/trip/:tripId')
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Manifeste d\'un voyage (PDF/CSV)' })
  async reportTrip(
    @Param('id') id: string,
    @Param('tripId') tripId: string,
    @CurrentUser() user: any,
    @Query('format') format: 'pdf' | 'csv' = 'pdf',
    @Res() reply: any,
  ) {
    this.assertStationAccess(user, id);
    const out = await this.reports.stationTripReport(id, user.tenantId, tripId, format);
    reply.header('Content-Type', out.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${out.filename}"`);
    reply.send(out.buffer);
  }
}
