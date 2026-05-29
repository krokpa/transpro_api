import {
  Body, Controller, Get, Param, Patch, Post,
  Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LuggageService } from './luggage.service';
import { AddBagPhotosDto, DeclareLuggageDto, ReportMissingDto, ScanBagDto } from './dto/luggage.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '@transpro/shared';

@ApiTags('Bagages')
@ApiBearerAuth()
@Controller('luggage')
export class LuggageController {
  constructor(private readonly svc: LuggageService) {}

  // ── Agent / Owner ─────────────────────────────────────────────────────────

  @Post('declare')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Déclarer les bagages d\'une réservation' })
  declare(@CurrentUser() user: any, @Body() dto: DeclareLuggageDto) {
    return this.svc.declare(user.tenantId, user.id, dto);
  }

  @Post('scan')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Scanner un QR de sac (DECLARED→LOADED→ARRIVED→CLAIMED)' })
  scan(@CurrentUser() user: any, @Body() dto: ScanBagDto) {
    return this.svc.scanBag(dto.qrCode, user.tenantId);
  }

  @Patch('bags/:bagId/missing')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Signaler un sac manquant (agent)' })
  reportMissing(
    @CurrentUser() user: any,
    @Param('bagId') bagId: string,
    @Body() dto: ReportMissingDto,
  ) {
    return this.svc.reportMissing(bagId, user.tenantId, dto);
  }

  @Get('booking/:bookingId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Bagages d\'une réservation' })
  getByBooking(@CurrentUser() user: any, @Param('bookingId') bookingId: string) {
    return this.svc.getByBooking(bookingId, user.tenantId);
  }

  @Get('trip/:tripId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Tous les bagages d\'un voyage' })
  getByTrip(@CurrentUser() user: any, @Param('tripId') tripId: string) {
    return this.svc.getByTrip(tripId, user.tenantId);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Lister les déclarations (filtrables par voyage / statut sac)' })
  findAll(
    @CurrentUser() user: any,
    @Query('tripId')  tripId?: string,
    @Query('status')  status?: string,
  ) {
    return this.svc.findAll(user.tenantId, { tripId, status });
  }

  // ── Passenger (authenticated) ─────────────────────────────────────────────

  @Get('my/:bookingId')
  @ApiOperation({ summary: 'Passager — voir ses bagages pour une réservation' })
  getMyLuggage(@CurrentUser() user: any, @Param('bookingId') bookingId: string) {
    return this.svc.getByBookingPublic(bookingId);
  }

  // ── Public (by QR code — for passenger scanning their own label) ──────────

  @Public()
  @Post('bags/report-missing')
  @ApiOperation({ summary: 'Public — Signaler un sac manquant via QR code' })
  reportMissingPublic(@Body() body: { qrCode: string; note?: string }) {
    return this.svc.reportMissingByQr(body.qrCode, { note: body.note });
  }

  // ── Photos ────────────────────────────────────────────────────────────────

  @Patch('bags/:bagId/photos')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Ajouter/remplacer les photos d\'un sac (max 2)' })
  addBagPhotos(
    @CurrentUser() user: any,
    @Param('bagId') bagId: string,
    @Body() dto: AddBagPhotosDto,
  ) {
    return this.svc.addBagPhotos(bagId, user.tenantId, dto);
  }
}
