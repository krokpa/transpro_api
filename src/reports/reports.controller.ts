import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERM } from '@transpro/shared';

@ApiTags('Rapports')
@Controller({ path: 'reports', version: '1' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission(PERM.REPORTS_COMPANY)
@ApiBearerAuth()
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('daily-sales')
  @ApiOperation({ summary: 'Rapport ventes journalières (PDF ou CSV)' })
  async dailySales(
    @Res() reply: any,
    @CurrentUser('tenantId') tenantId: string,
    @Query('date') date: string,
    @Query('format') format: 'pdf' | 'csv' = 'pdf',
  ) {
    const result = await this.reports.dailySales(tenantId, date, format);
    reply.header('Content-Type', result.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    reply.send(result.buffer);
  }

  @Get('weekly-summary')
  @ApiOperation({ summary: 'Bilan hebdomadaire (PDF ou CSV)' })
  async weeklySummary(
    @Res() reply: any,
    @CurrentUser('tenantId') tenantId: string,
    @Query('weekStart') weekStart: string,
    @Query('format') format: 'pdf' | 'csv' = 'pdf',
  ) {
    const result = await this.reports.weeklySummary(tenantId, weekStart, format);
    reply.header('Content-Type', result.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    reply.send(result.buffer);
  }

  @Get('trip/:tripId')
  @ApiOperation({ summary: 'Rapport par voyage — manifeste + revenus (PDF ou CSV)' })
  async tripReport(
    @Res() reply: any,
    @Param('tripId') tripId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('format') format: 'pdf' | 'csv' = 'pdf',
  ) {
    const result = await this.reports.tripReport(tenantId, tripId, format);
    reply.header('Content-Type', result.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    reply.send(result.buffer);
  }
}
