import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TripsService } from './trips.service';
import { CreateTripDto, UpdateTripStatusDto, SearchTripsDto } from './dto/trip.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserRole, TripStatus } from '@transpro/shared';

@ApiTags('Voyages')
@Controller({ path: 'trips', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class TripsController {
  constructor(private trips: TripsService) {}

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Rechercher des voyages (voyageurs)' })
  search(@Query() dto: SearchTripsDto) {
    return this.trips.search(dto);
  }

  @Post()
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Créer un voyage' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateTripDto) {
    return this.trips.create(tenantId, dto);
  }

  @Get()
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Lister les voyages de la compagnie' })
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('status') status?: TripStatus,
    @Query('routeId') routeId?: string,
    @Query('date') date?: string,
    @Query('tripClass') tripClass?: string,
  ) {
    return this.trips.findAll(tenantId, { status, routeId, date, tripClass });
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Détails d\'un voyage' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.trips.findOne(id, tenantId);
  }

  @Get(':id/seats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sièges d\'un voyage (temps réel)' })
  getSeats(@Param('id') id: string) {
    return this.trips.getSeats(id);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
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
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Bloquer / débloquer un siège' })
  toggleSeatBlock(
    @Param('id') id: string,
    @Param('seatNumber') seatNumber: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.trips.toggleSeatBlock(id, tenantId, seatNumber);
  }

  @Get(':id/seats/:seatNumber/booking')
  @ApiBearerAuth()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Infos de réservation d\'un siège' })
  getSeatBooking(
    @Param('id') id: string,
    @Param('seatNumber') seatNumber: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.trips.getSeatBooking(id, tenantId, seatNumber);
  }
}
