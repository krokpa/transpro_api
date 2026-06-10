import {
  Controller, Get, Patch, Post, Param, Query, Body, Req, Res,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettlementsService } from './settlements.service';
import { MarkProcessingDto } from './dto/mark-processing.dto';
import { MarkPaidDto } from './dto/mark-paid.dto';
import { MarkFailedDto } from './dto/mark-failed.dto';
import { TriggerSettlementDto } from './dto/trigger-settlement.dto';
import { SubmitBankDetailsDto } from './dto/submit-bank-details.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';
import { ForbiddenException } from '@nestjs/common';

@ApiTags('Reversements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settlements')
export class SettlementsController {
  constructor(private service: SettlementsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.COMPANY_OWNER)
  @ApiOperation({ summary: 'Lister les reversements (SUPER_ADMIN: tous, COMPANY_OWNER: les siens)' })
  findAll(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(req.user, { tenantId, status });
  }

  @Get('my/summary')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Résumé financier des reversements de la compagnie' })
  mySummary(@Req() req: any) {
    if (!req.user.tenantId) throw new ForbiddenException();
    return this.service.mySummary(req.user.tenantId);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.COMPANY_OWNER)
  @ApiOperation({ summary: 'Détails d\'un reversement avec les lignes' })
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user);
  }

  @Patch(':id/processing')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Marquer un reversement comme "virement initié"' })
  markProcessing(
    @Param('id') id: string,
    @Body() dto: MarkProcessingDto,
    @Req() req: any,
  ) {
    return this.service.markProcessing(id, dto, req.user.sub);
  }

  @Patch(':id/paid')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Valider le reversement comme "payé"' })
  markPaid(
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
    @Req() req: any,
  ) {
    return this.service.markPaid(id, dto, req.user.sub);
  }

  @Patch(':id/failed')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Marquer un reversement comme "échoué"' })
  markFailed(
    @Param('id') id: string,
    @Body() dto: MarkFailedDto,
    @Req() req: any,
  ) {
    return this.service.markFailed(id, dto, req.user.sub);
  }

  @Post('trigger')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Déclencher manuellement le calcul d\'un reversement' })
  triggerManual(@Body() dto: TriggerSettlementDto, @Req() req: any) {
    return this.service.triggerManual(dto.tenantId, dto.year, dto.month, req.user.sub);
  }

  @Patch(':id/bank')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Soumettre les coordonnées bancaires pour un reversement' })
  submitBankDetails(
    @Param('id') id: string,
    @Body() dto: SubmitBankDetailsDto,
    @Req() req: any,
  ) {
    if (!req.user.tenantId) throw new ForbiddenException();
    return this.service.submitBankDetails(id, dto, req.user.tenantId);
  }

  @Get('export/statement')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Exporter le relevé de reversements (PDF ou XLSX)' })
  async exportStatement(
    @Req() req: any,
    @Res() reply: any,
    @Query('from')    from:   string,
    @Query('to')      to:     string,
    @Query('format')  format: 'pdf' | 'xlsx' = 'pdf',
    @Query('tenantId') tenantId?: string,
  ) {
    const tId = req.user.role === 'SUPER_ADMIN' ? tenantId! : req.user.tenantId;
    if (!tId) throw new ForbiddenException();
    const result = await this.service.exportStatement(tId, from ?? new Date().toISOString().slice(0, 7), to ?? new Date().toISOString().slice(0, 7), format);
    reply.header('Content-Type', result.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    reply.send(result.buffer);
  }
}
