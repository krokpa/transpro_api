import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TripsService } from './trips.service';
import { CreateTripDto, UpdateTripStatusDto, SearchTripsDto } from './dto/trip.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PERM, TripStatus, UserRole } from '@transpro/shared';

@ApiTags('Voyages')
@Controller({ path: 'trips', version: '1' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TripsController {
  constructor(private trips: TripsService) {}

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Rechercher des voyages (voyageurs)' })
  search(@Query() dto: SearchTripsDto) {
    return this.trips.search(dto);
  }

  @Public()
  @Get('upcoming')
  @ApiOperation({ summary: 'Prochains départs disponibles (passagers)' })
  upcoming(@Query('limit') limit?: string) {
    return this.trips.upcoming(limit ? parseInt(limit, 10) : 10);
  }

  @Post()
  @ApiBearerAuth()
  @RequirePermission(PERM.TRIPS_CREATE)
  @ApiOperation({ summary: 'Créer un voyage' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateTripDto) {
    return this.trips.create(tenantId, dto);
  }

  @Get()
  @ApiBearerAuth()
  @RequirePermission(PERM.TRIPS_VIEW)
  @ApiOperation({ summary: 'Lister les voyages de la compagnie' })
  findAll(
    @CurrentUser() currentUser: any,
    @Query('status') status?: string,
    @Query('routeId') routeId?: string,
    @Query('date') date?: string,
    @Query('tripClass') tripClass?: string,
  ) {
    const stationId =
      currentUser.role === UserRole.COMPANY_AGENT ? (currentUser.stationId ?? null) : null;
    return this.trips.findAll(currentUser.tenantId, { status, routeId, date, tripClass, stationId });
  }

  @Get(':id')
  @ApiBearerAuth()
  @RequirePermission(PERM.TRIPS_VIEW)
  @ApiOperation({ summary: 'Détails d\'un voyage' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.trips.findOne(id, tenantId);
  }

  @Get(':id/seats')
  @ApiBearerAuth()
  @RequirePermission(PERM.TRIPS_VIEW)
  @ApiOperation({ summary: 'Sièges d\'un voyage (temps réel)' })
  getSeats(@Param('id') id: string) {
    return this.trips.getSeats(id);
  }

  @Public()
  @Get(':id/location')
  @ApiOperation({ summary: 'Dernière position GPS connue d\'un voyage (passagers)' })
  getLocation(@Param('id') id: string) {
    return this.trips.getLastLocation(id);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @RequirePermission(PERM.TRIPS_UPDATE_STATUS)
  @ApiOperation({ summary: 'Mettre à jour le statut d\'un voyage' })
  updateStatus(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateTripStatusDto,
  ) {
    return this.trips.updateStatus(id, tenantId, dto);
  }

  @Patch(':id/seats/:seatNumber/toggle-block')
  @ApiBearerAuth()
  @RequirePermission(PERM.TRIPS_VIEW)
  @ApiOperation({ summary: 'Bloquer / débloquer un siège' })
  toggleSeatBlock(
    @Param('id') id: string,
    @Param('seatNumber') seatNumber: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.trips.toggleSeatBlock(id, tenantId, seatNumber);
  }

  @Get(':id/manifest')
  @ApiBearerAuth()
  @RequirePermission(PERM.BOOKINGS_VIEW)
  @ApiOperation({ summary: 'Manifeste des passagers d\'un voyage' })
  getManifest(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.trips.manifest(id, tenantId);
  }

  @Get(':id/seats/:seatNumber/booking')
  @ApiBearerAuth()
  @RequirePermission(PERM.BOOKINGS_VIEW)
  @ApiOperation({ summary: 'Infos de réservation d\'un siège' })
  getSeatBooking(
    @Param('id') id: string,
    @Param('seatNumber') seatNumber: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.trips.getSeatBooking(id, tenantId, seatNumber);
  }
}
