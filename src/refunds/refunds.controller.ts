import {
  Controller, Get, Param, Patch, Body, UseGuards, Query, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RefundsService } from './refunds.service';
import { ProcessRefundDto } from './dto/refund.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Remboursements')
@Controller({ path: 'refunds', version: '1' })
@UseGuards(JwtAuthGuard)
export class RefundsController {
  constructor(private refunds: RefundsService) {}

  @Get('my')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remboursements du passager connecté' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  myRefunds(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.refunds.findByPassenger(userId, page, Math.min(limit, 100));
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Lister les remboursements de la compagnie' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.refunds.findByTenant(tenantId, page, Math.min(limit, 100));
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiOperation({ summary: 'Détail d\'un remboursement' })
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.refunds.findOne(id, tenantId);
  }

  @Patch(':id/start')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Prendre en charge un remboursement (PENDING → PROCESSING)' })
  startProcessing(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') agentId: string,
  ) {
    return this.refunds.startProcessing(id, tenantId, agentId);
  }

  @Patch(':id/process')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Finaliser un remboursement (COMPLETED / FAILED / REJECTED)' })
  process(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') agentId: string,
    @Body() dto: ProcessRefundDto,
  ) {
    return this.refunds.process(id, tenantId, agentId, dto);
  }
}
