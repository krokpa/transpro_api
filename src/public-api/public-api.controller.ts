import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, UseInterceptors, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ApiUsageInterceptor } from '../common/interceptors/api-usage.interceptor';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { RequireScope } from '../common/decorators/require-scope.decorator';
import { CreateExtBookingDto } from './dto/ext-booking.dto';
import { CreateExtParcelDto } from './dto/ext-parcel.dto';
import { SCOPE } from '@transpro/shared';

@ApiTags('API Publique (tiers)')
@ApiSecurity('X-API-Key')
@ApiHeader({ name: 'X-API-Key', description: 'Votre clé API TransPro', required: true })
@Controller({ path: 'ext', version: '1' })
@UseGuards(ApiKeyGuard)
@UseInterceptors(IdempotencyInterceptor, ApiUsageInterceptor)
export class PublicApiController {
  constructor(private service: PublicApiService) {}

  // ── Voyages ────────────────────────────────────────────────────────────────

  @Get('trips')
  @RequireScope(SCOPE.TRIPS_READ)
  @ApiOperation({ summary: 'Rechercher des voyages disponibles' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max 100 (défaut 50)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Décalage de pagination' })
  searchTrips(
    @Query('origin') origin: string,
    @Query('destination') destination: string,
    @Query('date') date: string,
    @Query('passengers') passengers: string,
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const tenantId = req.apiConsumer?.tenantId ?? undefined;
    return this.service.searchTrips({
      origin,
      destination,
      departureDate: date,
      passengers: passengers ? parseInt(passengers, 10) : 1,
      tenantId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('trips/:id')
  @RequireScope(SCOPE.TRIPS_READ)
  @ApiOperation({ summary: 'Détails d\'un voyage' })
  getTrip(@Param('id') id: string, @Req() req: any) {
    return this.service.getTrip(id, req.apiConsumer?.tenantId ?? undefined);
  }

  @Get('trips/:id/seats')
  @RequireScope(SCOPE.TRIPS_READ)
  @ApiOperation({ summary: 'Plan de salle : sièges et disponibilité d\'un voyage' })
  getTripSeats(@Param('id') id: string, @Req() req: any) {
    return this.service.getTripSeats(id, req.apiConsumer?.tenantId ?? undefined);
  }

  // ── Gares & Itinéraires ────────────────────────────────────────────────────

  @Get('stations')
  @RequireScope(SCOPE.STATIONS_READ)
  @ApiOperation({ summary: 'Lister les gares actives' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max 100 (défaut 50)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Décalage de pagination' })
  listStations(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listStations(
      req.apiConsumer?.tenantId ?? undefined,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  @Get('routes')
  @RequireScope(SCOPE.ROUTES_READ)
  @ApiOperation({ summary: 'Lister les itinéraires actifs' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max 100 (défaut 50)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Décalage de pagination' })
  listRoutes(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listRoutes(
      req.apiConsumer?.tenantId ?? undefined,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  // ── Villes, compagnies, plannings & avis ────────────────────────────────────

  @Get('cities')
  @RequireScope(SCOPE.CITIES_READ)
  @ApiOperation({ summary: 'Lister les villes desservies' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  listCities(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.service.listCities(limit ? parseInt(limit, 10) : undefined, offset ? parseInt(offset, 10) : undefined);
  }

  @Get('companies')
  @RequireScope(SCOPE.COMPANIES_READ)
  @ApiOperation({ summary: 'Lister les compagnies exposées sur l\'API' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  listCompanies(@Req() req: any, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.service.listCompanies(
      req.apiConsumer?.tenantId ?? undefined,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  @Get('schedules')
  @RequireScope(SCOPE.SCHEDULES_READ)
  @ApiOperation({ summary: 'Lister les plannings (départs récurrents)' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  listSchedules(@Req() req: any, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.service.listSchedules(
      req.apiConsumer?.tenantId ?? undefined,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  @Get('ratings')
  @RequireScope(SCOPE.RATINGS_READ)
  @ApiOperation({ summary: 'Lister les avis passagers (optionnellement par compagnie)' })
  @ApiQuery({ name: 'company', required: false, description: 'Slug de compagnie' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  listRatings(
    @Req() req: any,
    @Query('company') company?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listRatings({
      tenantId: req.apiConsumer?.tenantId ?? undefined,
      company,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  // ── Promotions ──────────────────────────────────────────────────────────────

  @Get('promotions/:code')
  @RequireScope(SCOPE.PROMOTIONS_READ)
  @ApiOperation({ summary: 'Valider un code promo' })
  validatePromo(@Param('code') code: string, @Req() req: any) {
    return this.service.validatePromo(code, req.apiConsumer?.tenantId ?? undefined);
  }

  // ── Réservations ───────────────────────────────────────────────────────────

  @Get('bookings')
  @RequireScope(SCOPE.BOOKINGS_READ)
  @ApiOperation({ summary: 'Lister les réservations créées via votre intégration' })
  @ApiQuery({ name: 'phone', required: false, description: 'Filtrer par téléphone passager' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  listBookings(
    @Req() req: any,
    @Query('phone') phone?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listBookings({
      apiConsumerId: req.apiConsumer?.id,
      phone,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('bookings')
  @RequireScope(SCOPE.BOOKINGS_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer une réservation pour un passager' })
  createBooking(
    @Body() body: CreateExtBookingDto,
    @Req() req: any,
  ) {
    return this.service.createBooking({
      ...body,
      tenantId: req.apiConsumer?.tenantId ?? undefined,
      apiConsumerId: req.apiConsumer?.id,
      isTest: req.apiEnvironment === 'TEST',
    });
  }

  @Get('bookings/:reference')
  @RequireScope(SCOPE.BOOKINGS_READ)
  @ApiOperation({ summary: 'Récupérer une réservation par sa référence' })
  getBooking(@Param('reference') reference: string, @Req() req: any) {
    return this.service.getBookingByReference(reference, req.apiConsumer?.tenantId ?? undefined);
  }

  @Get('bookings/:reference/tickets')
  @RequireScope(SCOPE.BOOKINGS_READ)
  @ApiOperation({ summary: 'Billets (QR codes) d\'une réservation confirmée' })
  getBookingTickets(@Param('reference') reference: string, @Req() req: any) {
    return this.service.getBookingTickets(reference, req.apiConsumer?.tenantId ?? undefined);
  }

  @Post('bookings/:reference/cancel')
  @RequireScope(SCOPE.BOOKINGS_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Annuler une réservation (créée via votre intégration)' })
  cancelBooking(@Param('reference') reference: string, @Req() req: any) {
    return this.service.cancelBooking(reference, req.apiConsumer?.tenantId ?? undefined, req.apiConsumer?.id);
  }

  @Post('bookings/:reference/pay')
  @RequireScope(SCOPE.BOOKINGS_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Relancer le paiement d\'une réservation en attente' })
  payBooking(@Param('reference') reference: string, @Req() req: any) {
    return this.service.payBooking(reference, req.apiConsumer?.tenantId ?? undefined);
  }

  // ── Colis ──────────────────────────────────────────────────────────────────

  @Post('parcels/quote')
  @RequireScope(SCOPE.PARCELS_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estimer le tarif d\'un colis' })
  quoteParcel(@Body() body: { tripId: string; weightKg: number }, @Req() req: any) {
    return this.service.quoteParcel(body?.tripId, Number(body?.weightKg), req.apiConsumer?.tenantId ?? undefined);
  }

  @Post('parcels')
  @RequireScope(SCOPE.PARCELS_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enregistrer un colis sur un voyage' })
  createParcel(@Body() body: CreateExtParcelDto, @Req() req: any) {
    return this.service.createParcel({
      ...body,
      tenantId: req.apiConsumer?.tenantId ?? undefined,
      isTest: req.apiEnvironment === 'TEST',
    });
  }

  @Get('parcels/:code')
  @RequireScope(SCOPE.PARCELS_READ)
  @ApiOperation({ summary: 'Suivre un colis par son code de tracking' })
  trackParcel(@Param('code') code: string, @Req() req: any) {
    return this.service.trackParcel(code, req.apiConsumer?.tenantId ?? undefined);
  }

  // ── Sandbox ─────────────────────────────────────────────────────────────────

  @Post('test/trigger-webhook')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Sandbox : déclencher un webhook de test (clé TEST requise)' })
  triggerTestWebhook(
    @Body() body: { event?: string },
    @Req() req: any,
  ) {
    return this.service.triggerTestWebhook(
      req.apiConsumer?.id,
      req.apiEnvironment,
      body?.event,
    );
  }

  // ── Meta ───────────────────────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Informations sur le consommateur associé à cette clé' })
  me(@Req() req: any) {
    const { webhookSecret, ...safe } = req.apiConsumer;
    return {
      consumer: safe,
      key: {
        id:          req.apiKey.id,
        name:        req.apiKey.name,
        environment: req.apiKey.environment,
        scopes:      req.apiKey.scopes,
        expiresAt:   req.apiKey.expiresAt,
      },
    };
  }
}
