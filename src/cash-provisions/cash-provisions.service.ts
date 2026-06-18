import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@transpro/shared';
import { StationCashPeriodsService } from '../station-cash-periods/station-cash-periods.service';

@Injectable()
export class CashProvisionsService {
  constructor(
    private prisma: PrismaService,
    private cashPeriods: StationCashPeriodsService,
  ) {}

  private async assertStation(stationId: string, tenantId: string) {
    const station = await this.prisma.station.findFirst({
      where: { id: stationId, tenantId },
    });
    if (!station) throw new NotFoundException('Gare introuvable');
    return station;
  }

  private include = {
    station:     { select: { id: true, name: true, code: true } },
    requestedBy: { select: { id: true, firstName: true, lastName: true } },
    approvedBy:  { select: { id: true, firstName: true, lastName: true } },
  };

  async create(dto: {
    stationId: string;
    amount:    number;
    reason?:   string;
    notes?:    string;
  }, user: any) {
    await this.assertStation(dto.stationId, user.tenantId);

    return this.prisma.cashProvision.create({
      data: {
        tenantId:      user.tenantId,
        stationId:     dto.stationId,
        amount:        dto.amount,
        reason:        dto.reason,
        notes:         dto.notes,
        requestedById: user.sub,
        status:        'REQUESTED',
      },
      include: this.include,
    });
  }

  async findAll(user: any, filters: { stationId?: string; status?: string }) {
    const where: any = { tenantId: user.tenantId };
    if (filters.stationId) where.stationId = filters.stationId;
    if (filters.status)    where.status    = filters.status;

    if (user.role === UserRole.COMPANY_AGENT && !filters.stationId && user.stationIds?.length) {
      where.stationId = { in: user.stationIds };
    }

    return this.prisma.cashProvision.findMany({
      where,
      include: this.include,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: any) {
    const prov = await this.prisma.cashProvision.findUnique({
      where: { id },
      include: this.include,
    });
    if (!prov) throw new NotFoundException('Approvisionnement introuvable');
    if (prov.tenantId !== user.tenantId) throw new ForbiddenException();
    return prov;
  }

  private async update(id: string, tenantId: string, data: any) {
    const prov = await this.prisma.cashProvision.findUnique({ where: { id } });
    if (!prov) throw new NotFoundException('Approvisionnement introuvable');
    if (prov.tenantId !== tenantId) throw new ForbiddenException();
    return this.prisma.cashProvision.update({
      where: { id },
      data,
      include: this.include,
    });
  }

  async approve(id: string, user: any) {
    const prov = await this.prisma.cashProvision.findUnique({ where: { id } });
    if (!prov) throw new NotFoundException();
    if (prov.tenantId !== user.tenantId) throw new ForbiddenException();
    if (prov.status !== 'REQUESTED') {
      throw new BadRequestException(`Statut actuel "${prov.status}" — impossible d'approuver`);
    }
    return this.update(id, user.tenantId, {
      status:      'APPROVED',
      approvedById: user.sub,
      approvedAt:  new Date(),
    });
  }

  async send(id: string, notes: string | undefined, user: any) {
    const prov = await this.prisma.cashProvision.findUnique({ where: { id } });
    if (!prov) throw new NotFoundException();
    if (prov.tenantId !== user.tenantId) throw new ForbiddenException();
    if (prov.status !== 'APPROVED') {
      throw new BadRequestException(`Statut actuel "${prov.status}" — approuver d'abord`);
    }
    return this.update(id, user.tenantId, {
      status:  'SENT',
      sentAt:  new Date(),
      ...(notes ? { notes } : {}),
    });
  }

  async receive(id: string, user: any) {
    const prov = await this.prisma.cashProvision.findUnique({ where: { id } });
    if (!prov) throw new NotFoundException();
    if (prov.tenantId !== user.tenantId) throw new ForbiddenException();
    if (prov.status !== 'SENT') {
      throw new BadRequestException(`Statut actuel "${prov.status}" — les fonds doivent être envoyés d'abord`);
    }
    const updated = await this.update(id, user.tenantId, {
      status:     'RECEIVED',
      receivedAt: new Date(),
    });

    const now = new Date();
    this.cashPeriods.recalculate(prov.stationId, prov.tenantId, now.getFullYear(), now.getMonth() + 1).catch(() => {});
    return updated;
  }

  async reject(id: string, reason: string, user: any) {
    const prov = await this.prisma.cashProvision.findUnique({ where: { id } });
    if (!prov) throw new NotFoundException();
    if (prov.tenantId !== user.tenantId) throw new ForbiddenException();
    if (!['REQUESTED', 'APPROVED'].includes(prov.status)) {
      throw new BadRequestException('Impossible de rejeter dans ce statut');
    }
    return this.update(id, user.tenantId, {
      status:         'REJECTED',
      rejectedAt:     new Date(),
      rejectedReason: reason,
    });
  }
}
