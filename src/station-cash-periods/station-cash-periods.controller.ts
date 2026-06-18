import {
  Controller, Get, Patch, Post, Param, Query, Body, Req, UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StationCashPeriodsService } from './station-cash-periods.service';
import { SetOpeningBalanceDto } from './dto/set-opening-balance.dto';
import { ClosePeriodDto } from './dto/close-period.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PERM } from '@transpro/shared';

@ApiTags('Périodes de caisse')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('station-cash-periods')
export class StationCashPeriodsController {
  constructor(private service: StationCashPeriodsService) {}

  @Get(':stationId/current')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Période courante d\'une gare (mois en cours)' })
  getCurrentPeriod(@Param('stationId') stationId: string, @Req() req: any) {
    return this.service.getCurrentPeriod(stationId, req.user.tenantId);
  }

  @Get(':stationId/history')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Historique des périodes d\'une gare (12 derniers mois)' })
  getHistory(
    @Param('stationId') stationId: string,
    @Req() req: any,
    @Query('limit') limit?: string,
  ) {
    return this.service.getHistory(stationId, req.user.tenantId, limit ? parseInt(limit) : 12);
  }

  @Get(':stationId/:year/:month')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Période spécifique d\'une gare' })
  getPeriod(
    @Param('stationId') stationId: string,
    @Param('year', ParseIntPipe)  year: number,
    @Param('month', ParseIntPipe) month: number,
    @Req() req: any,
  ) {
    return this.service.getPeriod(stationId, req.user.tenantId, year, month);
  }

  @Patch(':stationId/:year/:month/opening')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_APPROVE)
  @ApiOperation({ summary: 'Définir le solde d\'ouverture d\'une période' })
  setOpeningBalance(
    @Param('stationId') stationId: string,
    @Param('year', ParseIntPipe)  year: number,
    @Param('month', ParseIntPipe) month: number,
    @Body() dto: SetOpeningBalanceDto,
    @Req() req: any,
  ) {
    return this.service.setOpeningBalance(stationId, req.user.tenantId, year, month, dto, req.user.sub);
  }

  @Post(':stationId/:year/:month/close')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_APPROVE)
  @ApiOperation({ summary: 'Clôturer une période (saisir le solde physique)' })
  closePeriod(
    @Param('stationId') stationId: string,
    @Param('year', ParseIntPipe)  year: number,
    @Param('month', ParseIntPipe) month: number,
    @Body() dto: ClosePeriodDto,
    @Req() req: any,
  ) {
    return this.service.closePeriod(stationId, req.user.tenantId, year, month, dto, req.user.sub);
  }

  @Post(':stationId/:year/:month/validate')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_APPROVE)
  @ApiOperation({ summary: 'Valider une période clôturée (génère le report)' })
  validatePeriod(
    @Param('stationId') stationId: string,
    @Param('year', ParseIntPipe)  year: number,
    @Param('month', ParseIntPipe) month: number,
    @Req() req: any,
  ) {
    return this.service.validatePeriod(stationId, req.user.tenantId, year, month, req.user.sub);
  }

  @Post(':stationId/:year/:month/reopen')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_APPROVE)
  @ApiOperation({ summary: 'Rouvrir une période clôturée (annule la clôture)' })
  reopenPeriod(
    @Param('stationId') stationId: string,
    @Param('year', ParseIntPipe)  year: number,
    @Param('month', ParseIntPipe) month: number,
    @Req() req: any,
  ) {
    return this.service.reopenPeriod(stationId, req.user.tenantId, year, month, req.user.sub);
  }

  @Post(':stationId/:year/:month/recalculate')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_APPROVE)
  @ApiOperation({ summary: 'Forcer le recalcul d\'une période' })
  recalculate(
    @Param('stationId') stationId: string,
    @Param('year', ParseIntPipe)  year: number,
    @Param('month', ParseIntPipe) month: number,
    @Req() req: any,
  ) {
    return this.service.recalculate(stationId, req.user.tenantId, year, month);
  }
}
