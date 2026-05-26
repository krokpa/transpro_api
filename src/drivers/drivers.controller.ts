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
import { DriversService } from './drivers.service';
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Chauffeurs')
@Controller({ path: 'drivers', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
export class DriversController {
  constructor(private driversService: DriversService) {}

  @Post()
  @ApiOperation({ summary: 'Ajouter un chauffeur' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateDriverDto) {
    return this.driversService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les chauffeurs de la compagnie' })
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.driversService.findAll(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détails d\'un chauffeur' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.driversService.findOne(id, tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Mettre à jour un chauffeur' })
  update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateDriverDto,
  ) {
    return this.driversService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Désactiver un chauffeur' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.driversService.remove(id, tenantId);
  }
}
