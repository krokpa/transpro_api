import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto, CreateGuichetBookingDto, UpdateBookingStatusDto } from './dto/booking.dto';
import { RateBookingDto } from './dto/rate-booking.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Réservations')
@Controller({ path: 'bookings', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Créer une réservation (voyageur)' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateBookingDto) {
    return this.bookings.create(userId, dto);
  }

  @Post('guichet')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Vente directe au guichet — crée + confirme + génère les tickets' })
  createGuichet(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') agentId: string,
    @Body() dto: CreateGuichetBookingDto,
  ) {
    return this.bookings.createGuichet(tenantId, agentId, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Mes réservations' })
  myBookings(@CurrentUser('id') userId: string) {
    return this.bookings.findByPassenger(userId);
  }

  @Get('my/:id')
  @ApiOperation({ summary: 'Détail d\'une de mes réservations (passager)' })
  findMine(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.bookings.findOneForPassenger(id, userId);
  }

  @Post('my/:id/rate')
  @ApiOperation({ summary: 'Noter un voyage terminé' })
  rate(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RateBookingDto,
  ) {
    return this.bookings.rateBooking(id, userId, dto);
  }

  @Get()
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Réservations de la compagnie' })
  tenantBookings(
    @CurrentUser('tenantId') tenantId: string,
    @Query('status') status?: string,
    @Query('tripId') tripId?: string,
  ) {
    return this.bookings.findByTenant(tenantId, { status, tripId });
  }

  @Get(':id')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Détail d\'une réservation' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.bookings.findOne(id, tenantId);
  }

  @Post(':id/tickets/generate')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Générer les tickets manquants d\'une réservation confirmée' })
  generateTickets(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.bookings.generateMissingTickets(id, tenantId);
  }

  @Patch(':id/status')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Modifier le statut d\'une réservation (admin/owner)' })
  updateStatus(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookings.updateStatus(id, tenantId, dto.status);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Annuler une réservation' })
  cancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.bookings.cancel(id, userId);
  }
}
