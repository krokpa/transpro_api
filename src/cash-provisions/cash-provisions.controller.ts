import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CashProvisionsService } from './cash-provisions.service';
import { CreateCashProvisionDto } from './dto/create-cash-provision.dto';
import { SendProvisionDto } from './dto/send-provision.dto';
import { RejectProvisionDto } from './dto/reject-provision.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PERM } from '@transpro/shared';

@ApiTags('Approvisionnements Caisse')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cash-provisions')
export class CashProvisionsController {
  constructor(private service: CashProvisionsService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.PROVISIONS_MANAGE)
  @ApiOperation({ summary: 'Créer une demande d\'approvisionnement' })
  create(@Body() dto: CreateCashProvisionDto, @Req() req: any) {
    return this.service.create(dto, req.user);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.PROVISIONS_MANAGE)
  @ApiOperation({ summary: 'Lister les approvisionnements' })
  findAll(
    @Req() req: any,
    @Query('stationId') stationId?: string,
    @Query('status')    status?: string,
  ) {
    return this.service.findAll(req.user, { stationId, status });
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.PROVISIONS_MANAGE)
  @ApiOperation({ summary: 'Détail d\'un approvisionnement' })
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user);
  }

  @Patch(':id/approve')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.PROVISIONS_APPROVE)
  @ApiOperation({ summary: 'Approuver une demande' })
  approve(@Param('id') id: string, @Req() req: any) {
    return this.service.approve(id, req.user);
  }

  @Patch(':id/send')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.PROVISIONS_APPROVE)
  @ApiOperation({ summary: 'Marquer les fonds comme envoyés' })
  send(
    @Param('id') id: string,
    @Body() dto: SendProvisionDto,
    @Req() req: any,
  ) {
    return this.service.send(id, dto.notes, req.user);
  }

  @Patch(':id/receive')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.PROVISIONS_MANAGE)
  @ApiOperation({ summary: 'Confirmer la réception des fonds en gare' })
  receive(@Param('id') id: string, @Req() req: any) {
    return this.service.receive(id, req.user);
  }

  @Patch(':id/reject')
  @UseGuards(PermissionsGuard)
  @RequirePermission(PERM.PROVISIONS_APPROVE)
  @ApiOperation({ summary: 'Rejeter une demande' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectProvisionDto,
    @Req() req: any,
  ) {
    return this.service.reject(id, dto.reason, req.user);
  }
}
