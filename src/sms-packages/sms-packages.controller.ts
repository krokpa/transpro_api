import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, Headers, RawBodyRequest, Req,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { UserRole } from '@transpro/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SmsPackagesService } from './sms-packages.service';
import { CreateSmsPackageDto, UpdateSmsPackageDto, PurchaseSmsPackageDto } from './dto/sms-packages.dto';

@Controller('v1/sms-packages')
export class SmsPackagesController {
  constructor(private readonly svc: SmsPackagesService) {}

  // ── Public : liste active pour les compagnies ─────────────────────────────

  @Get()
  list() {
    return this.svc.listPackages(true);
  }

  // ── SUPER_ADMIN : CRUD ────────────────────────────────────────────────────

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  listAll() {
    return this.svc.listPackages(false);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() dto: CreateSmsPackageDto) {
    return this.svc.createPackage(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateSmsPackageDto) {
    return this.svc.updatePackage(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  remove(@Param('id') id: string) {
    return this.svc.deletePackage(id);
  }

  // ── Tenant : balance & logs ───────────────────────────────────────────────

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  balance(@CurrentUser() user: any) {
    return this.svc.getBalance(user.tenantId);
  }

  @Get('logs')
  @UseGuards(JwtAuthGuard)
  logs(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getLogs(user.tenantId, Number(page ?? 1), Number(limit ?? 20));
  }

  // ── Tenant : achat ────────────────────────────────────────────────────────

  @Post('purchase')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANY_OWNER)
  purchase(@CurrentUser() user: any, @Body() dto: PurchaseSmsPackageDto) {
    return this.svc.initiatePurchase(user.tenantId, dto);
  }

  @Get('purchase/:id/confirm')
  @UseGuards(JwtAuthGuard)
  confirmRedirect(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.confirmFromRedirect(id, user.tenantId);
  }

  // ── Webhook Genius Pay ────────────────────────────────────────────────────

  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('x-genius-signature') sig: string,
    @Headers('x-genius-timestamp') ts: string,
  ) {
    const rawBody = (req as any).rawBody?.toString() ?? JSON.stringify(req.body);
    return this.svc.handleWebhook(rawBody, sig, ts);
  }
}
