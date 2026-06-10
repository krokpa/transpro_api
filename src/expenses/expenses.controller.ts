import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PERM } from '@transpro/shared';

@ApiTags('Dépenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private service: ExpensesService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Créer une dépense' })
  create(@Body() dto: CreateExpenseDto, @Req() req: any) {
    return this.service.create(dto, req.user);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Lister les dépenses' })
  findAll(
    @Req() req: any,
    @Query('stationId') stationId?: string,
    @Query('status')    status?: string,
    @Query('category')  category?: string,
    @Query('from')      from?: string,
    @Query('to')        to?: string,
  ) {
    return this.service.findAll(req.user, { stationId, status, category, from, to });
  }

  @Get('station/:stationId/summary')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Résumé financier d\'une gare pour le mois' })
  stationSummary(
    @Param('stationId') stationId: string,
    @Query('month')     month: string,
    @Req()              req: any,
  ) {
    return this.service.stationSummary(stationId, req.user.tenantId, month);
  }

  @Get('station/:stationId/export')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.REPORTS_STATION)
  @ApiOperation({ summary: 'Exporter le relevé de caisse d\'une gare (PDF ou XLSX)' })
  async exportStationStatement(
    @Param('stationId') stationId: string,
    @Req()              req: any,
    @Res()              reply: any,
    @Query('from')      from: string,
    @Query('to')        to: string,
    @Query('format')    format: 'pdf' | 'xlsx' = 'pdf',
  ) {
    const now = new Date().toISOString().slice(0, 7);
    const result = await this.service.exportStationStatement(stationId, req.user.tenantId, from ?? now, to ?? now, format);
    reply.header('Content-Type', result.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    reply.send(result.buffer);
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Détail d\'une dépense' })
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user);
  }

  @Patch(':id/approve')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_APPROVE)
  @ApiOperation({ summary: 'Approuver une dépense' })
  approve(@Param('id') id: string, @Req() req: any) {
    return this.service.approve(id, req.user);
  }

  @Patch(':id/reject')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.EXPENSES_APPROVE)
  @ApiOperation({ summary: 'Rejeter une dépense' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectExpenseDto,
    @Req() req: any,
  ) {
    return this.service.reject(id, dto.reason, req.user);
  }
}
