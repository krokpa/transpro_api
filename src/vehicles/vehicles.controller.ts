import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Véhicules')
@Controller({ path: 'vehicles', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
export class VehiclesController {
  constructor(private vehiclesService: VehiclesService) {}

  @Post()
  @ApiOperation({ summary: 'Ajouter un véhicule' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les véhicules de la compagnie' })
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.vehiclesService.findAll(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détails d\'un véhicule' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.vehiclesService.findOne(id, tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Mettre à jour un véhicule' })
  update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehiclesService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Désactiver un véhicule' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.vehiclesService.remove(id, tenantId);
  }

  // ── Maintenance alerts ─────────────────────────────────────────────────────

  @Get('maintenance-alerts')
  @ApiOperation({ summary: 'Véhicules nécessitant une révision dans les 30 jours' })
  getMaintenanceAlerts(@CurrentUser('tenantId') tenantId: string) {
    return this.vehiclesService.getMaintenanceAlerts(tenantId);
  }

  // ── Fuel logs ──────────────────────────────────────────────────────────────

  @Get(':id/fuel-logs')
  @ApiOperation({ summary: 'Historique carburant d\'un véhicule' })
  getFuelLogs(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.vehiclesService.getFuelLogs(id, tenantId);
  }

  @Post(':id/fuel-logs')
  @ApiOperation({ summary: 'Enregistrer un plein de carburant' })
  addFuelLog(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: any,
  ) {
    return this.vehiclesService.addFuelLog(id, tenantId, dto);
  }

  @Delete(':id/fuel-logs/:logId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer un log carburant' })
  deleteFuelLog(
    @Param('id') id: string,
    @Param('logId') logId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.vehiclesService.deleteFuelLog(id, logId, tenantId);
  }

  // ── Maintenance logs ───────────────────────────────────────────────────────

  @Get(':id/maintenance-logs')
  @ApiOperation({ summary: 'Historique entretien d\'un véhicule' })
  getMaintenanceLogs(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.vehiclesService.getMaintenanceLogs(id, tenantId);
  }

  @Post(':id/maintenance-logs')
  @ApiOperation({ summary: 'Enregistrer une opération de maintenance' })
  addMaintenanceLog(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: any,
  ) {
    return this.vehiclesService.addMaintenanceLog(id, tenantId, dto);
  }

  @Delete(':id/maintenance-logs/:logId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer un log maintenance' })
  deleteMaintenanceLog(
    @Param('id') id: string,
    @Param('logId') logId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.vehiclesService.deleteMaintenanceLog(id, logId, tenantId);
  }
}
