import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ParcelsService } from './parcels.service';
import {
  AddParcelPhotosDto,
  CreateParcelDto,
  CreateDeliveryRequestDto,
  UpdateDeliveryRequestDto,
  ParcelFiltersDto,
  UpdateParcelStatusDto,
} from './dto/parcel.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard, RequiresPlan } from '../common/guards/plan.guard';
import { UserRole, TenantPlan } from '@transpro/shared';

@ApiTags('Parcels')
@ApiBearerAuth()
@Controller('parcels')
export class ParcelsController {
  constructor(private readonly parcels: ParcelsService) {}

  // ── Public tracking (no auth) ─────────────────────────────────────────────────

  @Public()
  @Get('track/:code')
  @ApiOperation({ summary: 'Suivre un colis par son code (public)' })
  trackByCode(@Param('code') code: string) {
    return this.parcels.trackByCode(code);
  }

  // ── Fee estimation ────────────────────────────────────────────────────────────

  @Get('estimate-fee')
  @ApiOperation({ summary: 'Estimer les frais d\'envoi' })
  estimateFee(
    @Query('tripId') tripId: string,
    @Query('weightKg') weightKg: string,
  ) {
    return this.parcels.estimateFee(tripId, parseFloat(weightKg) || 1);
  }

  // ── Passenger: create parcel (sends as authenticated user) ────────────────────

  @Post('my')
  @ApiOperation({ summary: 'Passager — envoyer un colis' })
  @UseGuards(PlanGuard)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  createAsPassenger(@CurrentUser() user: any, @Body() dto: CreateParcelDto) {
    // For passenger-initiated parcels, find the trip's tenant from the trip itself
    // (the passenger doesn't belong to a specific tenant)
    return this.parcels.createAsPassenger(user, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Passager — lister ses colis envoyés' })
  findMine(@CurrentUser() user: any) {
    return this.parcels.findBySender(user.id);
  }

  // ── Agent / Admin / Owner routes ──────────────────────────────────────────────

  @Post()
  @UseGuards(RolesGuard, PlanGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Guichet — enregistrer un colis' })
  create(@CurrentUser() user: any, @Body() dto: CreateParcelDto) {
    return this.parcels.create(user.tenantId, user.id, dto);
  }

  @Get()
  @UseGuards(RolesGuard, PlanGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Lister les colis du tenant' })
  findAll(@CurrentUser() user: any, @Query() filters: ParcelFiltersDto) {
    return this.parcels.findAll(user.tenantId, filters);
  }

  @Get('trip/:tripId')
  @UseGuards(RolesGuard, PlanGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Lister les colis d\'un voyage' })
  findByTrip(@CurrentUser() user: any, @Param('tripId') tripId: string) {
    return this.parcels.findByTrip(tripId, user.tenantId);
  }

  @Get(':id')
  @UseGuards(RolesGuard, PlanGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Détail d\'un colis' })
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.parcels.findOne(id, user.tenantId);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard, PlanGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Mettre à jour le statut d\'un colis' })
  updateStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateParcelStatusDto,
  ) {
    return this.parcels.updateStatus(id, user.tenantId, dto);
  }

  // ── Delivery requests ─────────────────────────────────────────────────────────

  // Public: recipient requests home delivery by tracking code (no auth required)
  @Public()
  @Post('track/:code/delivery-request')
  @ApiOperation({ summary: 'Public — Demander la livraison à domicile par code de suivi' })
  createDeliveryRequestByCode(
    @Param('code') code: string,
    @Body() dto: CreateDeliveryRequestDto,
  ) {
    return this.parcels.createDeliveryRequestByCode(code, dto);
  }

  @Public()
  @Get('track/:code/delivery-request')
  @ApiOperation({ summary: 'Public — Voir la demande de livraison d\'un colis' })
  getDeliveryRequestByCode(@Param('code') code: string) {
    return this.parcels.getDeliveryRequestByCode(code);
  }

  // Authenticated passenger: create/cancel delivery request for own parcel
  @Post(':id/delivery-request')
  @ApiOperation({ summary: 'Passager — Demander la livraison à domicile' })
  createDeliveryRequest(
    @CurrentUser() user: any,
    @Param('id') parcelId: string,
    @Body() dto: CreateDeliveryRequestDto,
  ) {
    // Passager can request for any parcel (ownership checked in service via senderId)
    return this.parcels.createDeliveryRequestByParcelAndUser(parcelId, user.id, dto);
  }

  @Get(':id/delivery-request')
  @ApiOperation({ summary: 'Voir la demande de livraison d\'un colis' })
  getDeliveryRequest(@CurrentUser() user: any, @Param('id') parcelId: string) {
    return this.parcels.getDeliveryRequestForUser(parcelId, user.id, user.tenantId);
  }

  @Delete(':id/delivery-request')
  @ApiOperation({ summary: 'Passager — Annuler sa demande de livraison' })
  cancelMyDeliveryRequest(@CurrentUser() user: any, @Param('id') parcelId: string) {
    return this.parcels.cancelDeliveryRequestByUser(parcelId, user.id);
  }

  // Agent/Owner: list all delivery requests
  @Get('delivery-requests')
  @UseGuards(RolesGuard, PlanGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Lister toutes les demandes de livraison du tenant' })
  listDeliveryRequests(
    @CurrentUser() user: any,
    @Query('status') status?: string,
  ) {
    return this.parcels.listDeliveryRequests(user.tenantId, status);
  }

  // Agent/Owner: update delivery request (assign, change status)
  @Patch('delivery-requests/:reqId')
  @UseGuards(RolesGuard, PlanGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @RequiresPlan(TenantPlan.PROFESSIONAL, TenantPlan.ENTERPRISE)
  @ApiOperation({ summary: 'Mettre à jour une demande de livraison' })
  updateDeliveryRequest(
    @CurrentUser() user: any,
    @Param('reqId') reqId: string,
    @Body() dto: UpdateDeliveryRequestDto,
  ) {
    return this.parcels.updateDeliveryRequest(reqId, user.tenantId, dto);
  }

  // ── Photos ────────────────────────────────────────────────────────────────

  @Patch(':id/photos')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Ajouter/remplacer les photos d\'un colis (max 2)' })
  addPhotos(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: AddParcelPhotosDto,
  ) {
    return this.parcels.addPhotos(id, user.tenantId, dto);
  }
}
