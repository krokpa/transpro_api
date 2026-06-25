import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitsService } from '../common/plan-limits.service';
import { OtpService } from '../otp/otp.service';
import { SmsRouterService } from '../sms/sms-router.service';
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';
import { UserRole } from '@transpro/shared';

@Injectable()
export class DriversService {
  constructor(
    private prisma: PrismaService,
    private planLimits: PlanLimitsService,
    private otpService: OtpService,
    private sms: SmsRouterService,
  ) {}

  async create(tenantId: string, dto: CreateDriverDto) {
    await this.planLimits.assertLimit(tenantId, 'drivers');

    const existing = await this.prisma.driver.findFirst({
      where: { licenseNumber: dto.licenseNumber, tenantId },
    });
    if (existing) {
      throw new ConflictException('Un chauffeur avec ce numéro de permis existe déjà');
    }

    // Chercher ou créer le compte User lié à ce numéro
    let userId: string | undefined;
    const existingUser = await this.prisma.user.findUnique({ where: { phone: dto.phone } });

    if (existingUser) {
      // Mettre à jour le rôle si nécessaire et lier au tenant
      if (existingUser.role !== UserRole.DRIVER) {
        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: { role: UserRole.DRIVER, tenantId },
        });
      }
      userId = existingUser.id;
    } else {
      // Créer un compte User avec un mot de passe temporaire aléatoire
      const tempPassword = nanoid(16);
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const newUser = await this.prisma.user.create({
        data: {
          phone: dto.phone,
          email: `driver-${nanoid(8)}@transpro.internal`,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: UserRole.DRIVER,
          tenantId,
          isVerified: true,
          isActive: true,
        },
      });
      userId = newUser.id;
    }

    const driver = await this.prisma.driver.create({
      data: {
        tenantId,
        userId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        licenseNumber: dto.licenseNumber,
        licenseExpiry: new Date(dto.licenseExpiry),
      },
    });

    // SMS d'invitation — non bloquant, message clair sans OTP qui expire
    this.sms.send(
      dto.phone,
      `Bienvenue sur {APP} ! Votre compte chauffeur a été créé.\n` +
      `Connectez-vous avec votre numéro de téléphone sur l'application ou sur le web.\n` +
      `Un code vous sera envoyé à chaque connexion.`,
    ).catch(() => {});

    return driver;
  }

  async invite(driverId: string, tenantId: string) {
    const driver = await this.findOne(driverId, tenantId);
    await this.otpService.send(driver.phone);
    return { message: `Code de connexion envoyé au ${driver.phone}` };
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

  // ── Stats ──────────────────────────────────────────────────────────────────

  async getStats(driverId: string, tenantId: string) {
    const driver = await this.findOne(driverId, tenantId);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [
      tripsTotal,
      tripsThisMonth,
      tripsLastMonth,
      tripsCompleted,
      tripsCancelled,
      evalData,
      absencesThisYear,
      absencesPending,
    ] = await Promise.all([
      this.prisma.trip.count({ where: { driverId, tenantId } }),
      this.prisma.trip.count({ where: { driverId, tenantId, departureAt: { gte: monthStart } } }),
      this.prisma.trip.count({ where: { driverId, tenantId, departureAt: { gte: lastMonthStart, lt: monthStart } } }),
      this.prisma.trip.count({ where: { driverId, tenantId, status: 'ARRIVED' } }),
      this.prisma.trip.count({ where: { driverId, tenantId, status: 'CANCELLED' } }),
      this.prisma.driverEvaluation.aggregate({
        where: { driverId },
        _avg: { rating: true, punctuality: true, safety: true, service: true },
        _count: { id: true },
      }),
      this.prisma.driverAbsence.count({ where: { driverId, startDate: { gte: yearStart } } }),
      this.prisma.driverAbsence.count({ where: { driverId, approved: false } }),
    ]);

    const totalResolved = tripsCompleted + tripsCancelled;
    const completionRate = totalResolved > 0
      ? Math.round((tripsCompleted / totalResolved) * 100)
      : null;

    const licenseExpiry = new Date(driver.licenseExpiry);
    const licenseExpiresInDays = Math.ceil(
      (licenseExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      tripsTotal,
      tripsThisMonth,
      tripsLastMonth,
      tripsCompleted,
      tripsCancelled,
      completionRate,
      avgRating: evalData._avg.rating ? Math.round(evalData._avg.rating * 10) / 10 : null,
      avgPunctuality: evalData._avg.punctuality ? Math.round(evalData._avg.punctuality * 10) / 10 : null,
      avgSafety: evalData._avg.safety ? Math.round(evalData._avg.safety * 10) / 10 : null,
      avgService: evalData._avg.service ? Math.round(evalData._avg.service * 10) / 10 : null,
      evaluationCount: evalData._count.id,
      absencesThisYear,
      absencesPending,
      licenseExpiresInDays,
      isLicenseExpired: licenseExpiresInDays < 0,
      isAvailable: driver.isAvailable,
    };
  }

  // ── Planning (trips assigned to driver) ────────────────────────────────────

  async getSchedule(driverId: string, tenantId: string, month: string) {
    await this.findOne(driverId, tenantId);
    const start = new Date(`${month}-01`);
    const end   = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const trips = await this.prisma.trip.findMany({
      where: { driverId, tenantId, departureAt: { gte: start, lt: end } },
      select: {
        id: true, departureAt: true, status: true, tripClass: true,
        price: true, totalSeats: true, availableSeats: true,
        route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
        vehicle: { select: { brand: true, model: true, plate: true, capacity: true } },
        departureStation: { select: { name: true } },
        arrivalStation: { select: { name: true } },
      },
      orderBy: { departureAt: 'asc' },
    });
    return trips.map((t) => ({
      ...t,
      departureTime: t.departureAt,
      route: t.route ? {
        origin: t.route.originCity?.name ?? '',
        destination: t.route.destinationCity?.name ?? '',
        name: t.route.name,
      } : null,
      vehicle: t.vehicle ? {
        plate: t.vehicle.plate,
        brand: t.vehicle.brand,
        model: t.vehicle.model,
        capacity: t.vehicle.capacity,
      } : null,
    }));
  }
}
