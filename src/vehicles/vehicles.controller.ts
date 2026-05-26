import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
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
}
