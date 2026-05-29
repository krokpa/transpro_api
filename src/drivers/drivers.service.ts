import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';

@Injectable()
export class DriversService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateDriverDto) {
    const existing = await this.prisma.driver.findFirst({
      where: { licenseNumber: dto.licenseNumber, tenantId },
    });
    if (existing) {
      throw new ConflictException('Un chauffeur avec ce numéro de permis existe déjà');
    }

    return this.prisma.driver.create({
      data: {
        tenantId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        licenseNumber: dto.licenseNumber,
        licenseExpiry: new Date(dto.licenseExpiry),
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.driver.findMany({
      where: { tenantId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findOne(id: string, tenantId: string) {
    const driver = await this.prisma.driver.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { trips: true } },
      },
    });

    if (!driver) throw new NotFoundException('Chauffeur introuvable');
    return driver;
  }

  async update(id: string, tenantId: string, dto: UpdateDriverDto) {
    await this.findOne(id, tenantId);

    const data: any = { ...dto };
    if (dto.licenseExpiry) {
      data.licenseExpiry = new Date(dto.licenseExpiry);
    }

    return this.prisma.driver.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);

    return this.prisma.driver.update({
      where: { id },
      data: { isAvailable: false },
    });
  }

  // ── Absences ───────────────────────────────────────────────────────────────

  async getAbsences(driverId: string, tenantId: string) {
    await this.findOne(driverId, tenantId);
    return this.prisma.driverAbsence.findMany({
      where: { driverId },
      orderBy: { startDate: 'desc' },
    });
  }

  async addAbsence(driverId: string, tenantId: string, dto: {
    startDate: string; endDate: string; type: string; reason?: string;
  }) {
    await this.findOne(driverId, tenantId);
    return this.prisma.driverAbsence.create({
      data: {
        driverId, tenantId,
        startDate: new Date(dto.startDate),
        endDate:   new Date(dto.endDate),
        type:      dto.type as any,
        reason:    dto.reason,
      },
    });
  }

  async updateAbsence(driverId: string, absenceId: string, tenantId: string, dto: { approved?: boolean; reason?: string }) {
    await this.findOne(driverId, tenantId);
    return this.prisma.driverAbsence.update({
      where: { id: absenceId },
      data: dto,
    });
  }

  async deleteAbsence(driverId: string, absenceId: string, tenantId: string) {
    await this.findOne(driverId, tenantId);
    return this.prisma.driverAbsence.delete({ where: { id: absenceId } });
  }

  // ── Evaluations ────────────────────────────────────────────────────────────

  async getEvaluations(driverId: string, tenantId: string) {
    await this.findOne(driverId, tenantId);
    const evals = await this.prisma.driverEvaluation.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const avg = evals.length > 0
      ? Math.round((evals.reduce((s, e) => s + e.rating, 0) / evals.length) * 10) / 10
      : null;
    return { evaluations: evals, averageRating: avg, count: evals.length };
  }

  async addEvaluation(driverId: string, tenantId: string, evaluatedById: string, dto: {
    rating: number; punctuality?: number; safety?: number; service?: number;
    comment?: string; tripId?: string;
  }) {
    await this.findOne(driverId, tenantId);
    return this.prisma.driverEvaluation.create({
      data: {
        driverId, tenantId, evaluatedById,
        rating:      dto.rating,
        punctuality: dto.punctuality,
        safety:      dto.safety,
        service:     dto.service,
        comment:     dto.comment,
        tripId:      dto.tripId,
      },
    });
  }

  async deleteEvaluation(driverId: string, evalId: string, tenantId: string) {
    await this.findOne(driverId, tenantId);
    return this.prisma.driverEvaluation.delete({ where: { id: evalId } });
  }

  // ── Planning (trips assigned to driver) ────────────────────────────────────

  async getSchedule(driverId: string, tenantId: string, month: string) {
    await this.findOne(driverId, tenantId);
    const start = new Date(`${month}-01`);
    const end   = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return this.prisma.trip.findMany({
      where: { driverId, tenantId, departureAt: { gte: start, lt: end } },
      select: {
        id: true, departureAt: true, status: true, tripClass: true,
        route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
      },
      orderBy: { departureAt: 'asc' },
    });
  }
}
