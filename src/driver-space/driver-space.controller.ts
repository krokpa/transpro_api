import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DriverSpaceService } from './driver-space.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Espace Chauffeur')
@Controller({ path: 'driver-space', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DRIVER)
@ApiBearerAuth()
export class DriverSpaceController {
  constructor(private service: DriverSpaceService) {}

  // ── Profil ─────────────────────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Mon profil + statistiques' })
  getMe(@CurrentUser('driverId') driverId: string) {
    return this.service.getMe(driverId);
  }

  @Patch('availability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Changer ma disponibilité' })
  setAvailability(
    @CurrentUser('driverId') driverId: string,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    return this.service.setAvailability(driverId, isAvailable);
  }

  // ── Voyages ────────────────────────────────────────────────────────────────

  @Get('trips/today')
  @ApiOperation({ summary: 'Mes voyages du jour' })
  getTodayTrips(@CurrentUser('driverId') driverId: string) {
    return this.service.getTodayTrips(driverId);
  }

  @Get('trips/upcoming')
  @ApiOperation({ summary: 'Mes prochains voyages (7 jours)' })
  getUpcomingTrips(@CurrentUser('driverId') driverId: string) {
    return this.service.getUpcomingTrips(driverId);
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Mon planning mensuel' })
  getSchedule(
    @CurrentUser('driverId') driverId: string,
    @Query('month') month: string,
  ) {
    const m = month ?? new Date().toISOString().slice(0, 7);
    return this.service.getSchedule(driverId, m);
  }

  @Patch('trips/:tripId/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mettre à jour le statut d\'un voyage' })
  updateTripStatus(
    @CurrentUser('driverId') driverId: string,
    @Param('tripId') tripId: string,
    @Body('status') status: string,
  ) {
    return this.service.updateTripStatus(driverId, tripId, status);
  }

  // ── Évaluations ────────────────────────────────────────────────────────────

  @Get('evaluations')
  @ApiOperation({ summary: 'Mes évaluations' })
  getEvaluations(@CurrentUser('driverId') driverId: string) {
    return this.service.getEvaluations(driverId);
  }

  // ── Absences ───────────────────────────────────────────────────────────────

  @Get('absences')
  @ApiOperation({ summary: 'Mes absences' })
  getAbsences(@CurrentUser('driverId') driverId: string) {
    return this.service.getAbsences(driverId);
  }

  // ── Dernière position connue ───────────────────────────────────────────────

  @Get('trips/:tripId/last-location')
  @ApiOperation({ summary: 'Dernière position connue d\'un voyage (pour late-join)' })
  getLastLocation(@Param('tripId') tripId: string) {
    return this.service.getLastLocation(tripId);
  }

  @Post('absences')
  @ApiOperation({ summary: 'Déclarer une absence' })
  addAbsence(
    @CurrentUser('driverId') driverId: string,
    @Body() dto: any,
  ) {
    return this.service.addAbsence(driverId, dto);
  }
}
