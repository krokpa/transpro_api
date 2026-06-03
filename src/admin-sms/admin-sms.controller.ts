import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode,
} from '@nestjs/common';
import { UserRole } from '@transpro/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminSmsService } from './admin-sms.service';

@Controller('v1/admin/sms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminSmsController {
  constructor(private readonly svc: AdminSmsService) {}

  /** Stats globales : volume, providers, timeline, top compagnies */
  @Get('overview')
  overview(@Query('days') days?: string) {
    return this.svc.getOverview(days ? Number(days) : 30);
  }

  /** Logs de tous les tenants, filtrables */
  @Get('logs')
  logs(
    @Query('page')      page?:     string,
    @Query('limit')     limit?:    string,
    @Query('tenantId')  tenantId?: string,
    @Query('provider')  provider?: string,
    @Query('status')    status?:   string,
    @Query('search')    search?:   string,
    @Query('dateFrom')  dateFrom?: string,
    @Query('dateTo')    dateTo?:   string,
  ) {
    return this.svc.getLogs({
      page:     page     ? Number(page)  : 1,
      limit:    limit    ? Number(limit) : 25,
      tenantId: tenantId || undefined,
      provider: provider || undefined,
      status:   status   || undefined,
      search:   search   || undefined,
      dateFrom: dateFrom || undefined,
      dateTo:   dateTo   || undefined,
    });
  }

  /** Crédits SMS de toutes les compagnies */
  @Get('credits')
  credits() {
    return this.svc.getAllCredits();
  }

  /** Attribuer des crédits manuellement à une compagnie */
  @Post('credits/:tenantId/grant')
  @HttpCode(201)
  grant(
    @Param('tenantId') tenantId: string,
    @Body() body: { smsCount: number; customSender?: string; note?: string },
  ) {
    return this.svc.grantCredits(tenantId, body.smsCount, body.customSender, body.note);
  }

  /** Statut des providers (configuré / actif / ordre) */
  @Get('providers')
  providers() {
    return this.svc.getProvidersStatus();
  }

  /** Envoyer un SMS de test */
  @Post('test')
  @HttpCode(200)
  test(@Body() body: { to: string; message: string }) {
    return this.svc.sendTest(body.to, body.message);
  }

  /** Gestion des packs SMS */
  @Get('packages')
  listPackages() {
    return this.svc.listPackages();
  }

  @Post('packages')
  @HttpCode(201)
  createPackage(@Body() body: {
    name: string; smsCount: number; priceXof: number;
    hasCustomSender?: boolean; sortOrder?: number;
  }) {
    return this.svc.createPackage(body);
  }

  @Patch('packages/:id')
  updatePackage(
    @Param('id') id: string,
    @Body() body: {
      name?: string; smsCount?: number; priceXof?: number;
      hasCustomSender?: boolean; isActive?: boolean; sortOrder?: number;
    },
  ) {
    return this.svc.updatePackage(id, body);
  }
}
