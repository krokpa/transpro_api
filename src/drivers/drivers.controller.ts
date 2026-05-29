import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
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

  // ── Planning (trips) ───────────────────────────────────────────────────────

  @Get(':id/schedule')
  @ApiOperation({ summary: 'Planning mensuel d\'un chauffeur (voyages assignés)' })
  getSchedule(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('month') month: string,
  ) {
    return this.driversService.getSchedule(id, tenantId, month ?? new Date().toISOString().slice(0, 7));
  }

  // ── Absences ───────────────────────────────────────────────────────────────

  @Get(':id/absences')
  @ApiOperation({ summary: 'Absences d\'un chauffeur' })
  getAbsences(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.driversService.getAbsences(id, tenantId);
  }

  @Post(':id/absences')
  @ApiOperation({ summary: 'Déclarer une absence' })
  addAbsence(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: any,
  ) {
    return this.driversService.addAbsence(id, tenantId, dto);
  }

  @Patch(':id/absences/:absenceId')
  @ApiOperation({ summary: 'Approuver / modifier une absence' })
  updateAbsence(
    @Param('id') id: string,
    @Param('absenceId') absenceId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: any,
  ) {
    return this.driversService.updateAbsence(id, absenceId, tenantId, dto);
  }

  @Delete(':id/absences/:absenceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer une absence' })
  deleteAbsence(
    @Param('id') id: string,
    @Param('absenceId') absenceId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.driversService.deleteAbsence(id, absenceId, tenantId);
  }

  // ── Evaluations ────────────────────────────────────────────────────────────

  @Get(':id/evaluations')
  @ApiOperation({ summary: 'Évaluations d\'un chauffeur' })
  getEvaluations(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.driversService.getEvaluations(id, tenantId);
  }

  @Post(':id/evaluations')
  @ApiOperation({ summary: 'Évaluer un chauffeur' })
  addEvaluation(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') evaluatedById: string,
    @Body() dto: any,
  ) {
    return this.driversService.addEvaluation(id, tenantId, evaluatedById, dto);
  }

  @Delete(':id/evaluations/:evalId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer une évaluation' })
  deleteEvaluation(
    @Param('id') id: string,
    @Param('evalId') evalId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.driversService.deleteEvaluation(id, evalId, tenantId);
  }
}
