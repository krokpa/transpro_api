import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, UseInterceptors, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader, ApiSecurity } from '@nestjs/swagger';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ApiUsageInterceptor } from '../common/interceptors/api-usage.interceptor';
import { RequireScope } from '../common/decorators/require-scope.decorator';
import { SCOPE } from '@transpro/shared';

@ApiTags('API Publique (tiers)')
@ApiSecurity('X-API-Key')
@ApiHeader({ name: 'X-API-Key', description: 'Votre clé API TransPro', required: true })
@Controller({ path: 'ext', version: '1' })
@UseGuards(ApiKeyGuard)
@UseInterceptors(ApiUsageInterceptor)
export class PublicApiController {
  constructor(private service: PublicApiService) {}

  // ── Voyages ────────────────────────────────────────────────────────────────

  @Get('trips')
  @RequireScope(SCOPE.TRIPS_READ)
  @ApiOperation({ summary: 'Rechercher des voyages disponibles' })
  searchTrips(
    @Query('origin') origin: string,
    @Query('destination') destination: string,
    @Query('date') date: string,
    @Query('passengers') passengers: string,
    @Req() req: any,
  ) {
    const tenantId = req.apiConsumer?.tenantId ?? undefined;
    return this.service.searchTrips({
      origin,
      destination,
      departureDate: date,
      passengers: passengers ? parseInt(passengers, 10) : 1,
      tenantId,
    });
  }

  @Get('trips/:id')
  @RequireScope(SCOPE.TRIPS_READ)
  @ApiOperation({ summary: 'Détails d\'un voyage' })
  getTrip(@Param('id') id: string, @Req() req: any) {
    return this.service.getTrip(id, req.apiConsumer?.tenantId ?? undefined);
  }

  // ── Gares & Itinéraires ────────────────────────────────────────────────────

  @Get('stations')
  @RequireScope(SCOPE.STATIONS_READ)
  @ApiOperation({ summary: 'Lister les gares actives' })
  listStations(@Req() req: any) {
    return this.service.listStations(req.apiConsumer?.tenantId ?? undefined);
  }

  @Get('routes')
  @RequireScope(SCOPE.ROUTES_READ)
  @ApiOperation({ summary: 'Lister les itinéraires actifs' })
  listRoutes(@Req() req: any) {
    return this.service.listRoutes(req.apiConsumer?.tenantId ?? undefined);
  }

  // ── Réservations ───────────────────────────────────────────────────────────

  @Post('bookings')
  @RequireScope(SCOPE.BOOKINGS_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer une réservation pour un passager' })
  createBooking(
    @Body() body: {
      tripId:          string;
      passengerPhone:  string;
      passengerEmail?: string;
      passengerName:   string;
      seatNumbers:     string[];
    },
    @Req() req: any,
  ) {
    return this.service.createBooking({
      ...body,
      tenantId: req.apiConsumer?.tenantId ?? undefined,
    });
  }

  @Get('bookings/:reference')
  @RequireScope(SCOPE.BOOKINGS_READ)
  @ApiOperation({ summary: 'Récupérer une réservation par sa référence' })
  getBooking(@Param('reference') reference: string, @Req() req: any) {
    return this.service.getBookingByReference(reference, req.apiConsumer?.tenantId ?? undefined);
  }

  // ── Colis ──────────────────────────────────────────────────────────────────

  @Get('parcels/:code')
  @RequireScope(SCOPE.PARCELS_READ)
  @ApiOperation({ summary: 'Suivre un colis par son code de tracking' })
  trackParcel(@Param('code') code: string) {
    return this.service.trackParcel(code);
  }

  // ── Meta ───────────────────────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Informations sur le consommateur associé à cette clé' })
  me(@Req() req: any) {
    const { webhookSecret, ...safe } = req.apiConsumer;
    return {
      consumer: safe,
      key: {
        id:        req.apiKey.id,
        name:      req.apiKey.name,
        scopes:    req.apiKey.scopes,
        expiresAt: req.apiKey.expiresAt,
      },
    };
  }
}
