import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto, UpdateScheduleDto, GenerateTripsDto } from './dto/schedule.dto';
import { CreateClosureDayDto } from './dto/closure.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Plannings')
@Controller({ path: 'schedules', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
export class SchedulesController {
  constructor(private schedules: SchedulesService) {}

  @Post()
  @ApiOperation({ summary: 'Créer un planning de départ' })
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateScheduleDto) {
    return this.schedules.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les plannings' })
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.schedules.findAll(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détails d\'un planning' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.schedules.findOne(id, tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un planning' })
  update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.schedules.update(id, tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un planning' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.schedules.remove(id, tenantId);
  }

  @Post(':id/generate')
  @ApiOperation({ summary: 'Générer les voyages d\'un planning pour N jours' })
  generate(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: GenerateTripsDto,
  ) {
    return this.schedules.generateFromSchedule(tenantId, id, dto.daysAhead);
  }

  @Post('generate-all')
  @ApiOperation({ summary: 'Générer tous les voyages des plannings actifs' })
  generateAll(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: GenerateTripsDto,
  ) {
    return this.schedules.generateAll(tenantId, dto.daysAhead);
  }

  // ─── Jours fériés / Fermetures ────────────────────────────────────────────

  @Get('closures/national')
  @ApiOperation({ summary: 'Lister les jours fériés nationaux CI' })
  nationalHolidays() {
    return this.schedules.findNationalHolidays();
  }

  @Get('closures')
  @ApiOperation({ summary: 'Lister les jours de fermeture de la compagnie' })
  findClosures(@CurrentUser('tenantId') tenantId: string) {
    return this.schedules.findClosures(tenantId);
  }

  @Post('closures')
  @ApiOperation({ summary: 'Ajouter un jour de fermeture' })
  createClosure(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateClosureDayDto,
  ) {
    return this.schedules.createClosure(tenantId, dto);
  }

  @Delete('closures/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un jour de fermeture' })
  removeClosure(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.schedules.removeClosure(id, tenantId);
  }
}
