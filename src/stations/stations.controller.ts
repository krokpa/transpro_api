import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Res, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StationsService } from './stations.service';
import { ReportsService } from '../reports/reports.service';
import { CreateStationDto, UpdateStationDto, AssignMemberDto } from './dto/station.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Gares')
@Controller({ path: 'stations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class StationsController {
  constructor(
    private stations: StationsService,
    private reports: ReportsService,
  ) {}

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
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Créer une gare' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateStationDto) {
    return this.stations.create(tenantId, dto);
  }

  @Get()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Lister les gares' })
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.stations.findAll(tenantId);
  }

  @Get(':id')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Détails d\'une gare' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.stations.findOne(id, tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
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
  @ApiOperation({ summary: 'Supprimer une gare' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.stations.remove(id, tenantId);
  }

  // ── Members ──────────────────────────────────────────────────────────────

  @Get(':id/members')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Membres affectés à la gare' })
  getMembers(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.stations.getMembers(id, tenantId);
  }

  @Post(':id/members')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Affecter un agent à la gare' })
  assignMember(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: AssignMemberDto,
  ) {
    return this.stations.assignMember(id, tenantId, dto);
  }

  @Delete(':id/members/:userId')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
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
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Tableau de bord de la gare (stats du jour)' })
  getDashboard(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.stations.getDashboard(id, tenantId);
  }

  @Get(':id/trips')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Voyages au départ de la gare (jour courant ou date précisée)' })
  getTodayTrips(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('date') date?: string,
  ) {
    return this.stations.getTodayTrips(id, tenantId, date);
  }

  @Get(':id/bookings')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Réservations vendues par la gare' })
  getBookings(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.stations.getBookings(id, tenantId, {
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @Get(':id/caisse')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Caisse de la gare' })
  getCaisse(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('date') date?: string,
  ) {
    return this.stations.getCaisse(id, tenantId, date);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  @Get(':id/analytics')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Analytiques de la gare (30 derniers jours par défaut)' })
  getAnalytics(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('days') days?: string,
  ) {
    return this.stations.getAnalytics(id, tenantId, days ? parseInt(days, 10) : 30);
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  @Get(':id/reports/daily-sales')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Rapport ventes journalières de la gare (PDF/CSV)' })
  async reportDailySales(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('date') date: string,
    @Query('format') format: 'pdf' | 'csv' = 'pdf',
    @Res() reply: any,
  ) {
    const out = await this.reports.stationDailySales(id, tenantId, date, format);
    reply.header('Content-Type', out.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${out.filename}"`);
    reply.send(out.buffer);
  }

  @Get(':id/reports/weekly-summary')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Bilan hebdomadaire de la gare (PDF/CSV)' })
  async reportWeeklySummary(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('weekStart') weekStart: string,
    @Query('format') format: 'pdf' | 'csv' = 'pdf',
    @Res() reply: any,
  ) {
    const out = await this.reports.stationWeeklySummary(id, tenantId, weekStart, format);
    reply.header('Content-Type', out.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${out.filename}"`);
    reply.send(out.buffer);
  }

  @Get(':id/reports/trip/:tripId')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Manifeste d\'un voyage (PDF/CSV)' })
  async reportTrip(
    @Param('id') id: string,
    @Param('tripId') tripId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('format') format: 'pdf' | 'csv' = 'pdf',
    @Res() reply: any,
  ) {
    const out = await this.reports.stationTripReport(id, tenantId, tripId, format);
    reply.header('Content-Type', out.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${out.filename}"`);
    reply.send(out.buffer);
  }
}
