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
import { RoutesService } from './routes.service';
import { CreateRouteDto, UpdateRouteDto } from './dto/route.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Itinéraires')
@Controller({ path: 'routes', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
export class RoutesController {
  constructor(private routesService: RoutesService) {}

  @Post()
  @ApiOperation({ summary: 'Créer un itinéraire' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateRouteDto) {
    return this.routesService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les itinéraires de la compagnie' })
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.routesService.findAll(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détails d\'un itinéraire' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.routesService.findOne(id, tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Mettre à jour un itinéraire' })
  update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.routesService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Désactiver un itinéraire' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.routesService.remove(id, tenantId);
  }
}
