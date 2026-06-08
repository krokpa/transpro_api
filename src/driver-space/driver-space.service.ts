import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DriverSpaceService {
  constructor(private prisma: PrismaService) {}

  private async getDriver(driverId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        tenant: { select: { id: true, name: true, logo: true, slug: true } },
      },
    });
    if (!driver) throw new NotFoundException('Chauffeur introuvable');
    return driver;
  }

  // ── Profil + stats ─────────────────────────────────────────────────────────

  async getMe(driverId: string) {
    const driver = await this.getDriver(driverId);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart  = new Date(now.getFullYear(), 0, 1);

    const [tripsTotal, tripsThisMonth, tripsCompleted, evalData, absencesThisYear] =
      await Promise.all([
        this.prisma.trip.count({ where: { driverId } }),
        this.prisma.trip.count({ where: { driverId, departureAt: { gte: monthStart } } }),
        this.prisma.trip.count({ where: { driverId, status: 'ARRIVED' } }),
        this.prisma.driverEvaluation.aggregate({
          where: { driverId },
          _avg: { rating: true },
          _count: { id: true },
        }),
        this.prisma.driverAbsence.count({ where: { driverId, startDate: { gte: yearStart } } }),
      ]);

    const licenseExpiresInDays = Math.ceil(
      (new Date(driver.licenseExpiry).getTime() - now.getTime()) / 86_400_000,
    );

    return {
      driver,
      stats: {
        tripsTotal,
        tripsThisMonth,
        tripsCompleted,
        completionRate: tripsTotal > 0 ? Math.round((tripsCompleted / tripsTotal) * 100) : null,
        avgRating: evalData._avg.rating
          ? Math.round(evalData._avg.rating * 10) / 10
          : null,
        evaluationCount: evalData._count.id,
        absencesThisYear,
        licenseExpiresInDays,
        isLicenseExpired: licenseExpiresInDays < 0,
      },
    };
  }

  // ── Voyages ────────────────────────────────────────────────────────────────

  private tripSelect() {
    return {
      id: true, departureAt: true, status: true, tripClass: true,
      price: true, totalSeats: true, availableSeats: true, delayMinutes: true,
      notes: true,
      route: {
        select: {
          name: true,
          originCity: { select: { name: true } },
          destinationCity: { select: { name: true } },
          distanceKm: true, durationMinutes: true,
        },
      },
      vehicle: {
        select: { brand: true, model: true, plate: true, capacity: true },
      },
      departureStation: { select: { id: true, name: true, address: true } },
      arrivalStation:   { select: { id: true, name: true, address: true } },
    };
  }

  async getTodayTrips(driverId: string) {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    return this.prisma.trip.findMany({
      where: { driverId, departureAt: { gte: start, lt: end } },
      select: this.tripSelect(),
      orderBy: { departureAt: 'asc' },
    });
  }

  async getUpcomingTrips(driverId: string) {
    const now  = new Date();
    const end  = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    return this.prisma.trip.findMany({
      where: {
        driverId,
        departureAt: { gte: now, lt: end },
        status: { in: ['SCHEDULED', 'BOARDING', 'DELAYED'] },
      },
      select: this.tripSelect(),
      orderBy: { departureAt: 'asc' },
    });
  }

  async getSchedule(driverId: string, month: string) {
    const start = new Date(`${month}-01`);
    const end   = new Date(start.getFullYear(), start.getMonth() + 1, 1);

    return this.prisma.trip.findMany({
      where: { driverId, departureAt: { gte: start, lt: end } },
      select: this.tripSelect(),
      orderBy: { departureAt: 'asc' },
    });
  }

  async updateTripStatus(driverId: string, tripId: string, status: string) {
    const ALLOWED = ['BOARDING', 'DEPARTED', 'ARRIVED', 'DELAYED'];
    if (!ALLOWED.includes(status)) {
      throw new BadRequestException(`Statut non autorisé. Valeurs possibles : ${ALLOWED.join(', ')}`);
    }

    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, driverId } });
    if (!trip) throw new ForbiddenException('Voyage introuvable ou non assigné à ce chauffeur');

    const TRANSITIONS: Record<string, string[]> = {
      SCHEDULED: ['BOARDING', 'DELAYED'],
      BOARDING:  ['DEPARTED', 'DELAYED'],
      DELAYED:   ['BOARDING', 'DEPARTED'],
      DEPARTED:  ['ARRIVED'],
    };

    if (!TRANSITIONS[trip.status]?.includes(status)) {
      throw new BadRequestException(
        `Transition ${trip.status} → ${status} non autorisée`,
      );
    }

    return this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: status as any,
        ...(status === 'DEPARTED' ? { actualDepartureAt: new Date() } : {}),
        ...(status === 'ARRIVED'  ? { actualArrivalAt:   new Date() } : {}),
      },
      select: this.tripSelect(),
    });
  }

  // ── Évaluations ────────────────────────────────────────────────────────────

  async getEvaluations(driverId: string) {
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

  // ── Absences ───────────────────────────────────────────────────────────────

  async getAbsences(driverId: string) {
    return this.prisma.driverAbsence.findMany({
      where: { driverId },
      orderBy: { startDate: 'desc' },
    });
  }

  async addAbsence(driverId: string, dto: {
    startDate: string; endDate: string; type: string; reason?: string;
  }) {
    const driver = await this.getDriver(driverId);
    return this.prisma.driverAbsence.create({
      data: {
        driverId,
        tenantId: driver.tenantId,
        startDate: new Date(dto.startDate),
        endDate:   new Date(dto.endDate),
        type:      dto.type as any,
        reason:    dto.reason,
      },
    });
  }

  // ── Dernière position connue ───────────────────────────────────────────────

  async getLastLocation(tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true, status: true,
        currentLat: true, currentLng: true,
        currentHeading: true, currentSpeed: true,
        locationUpdatedAt: true,
      },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable');
    if (trip.currentLat == null) return { hasLocation: false };
    return {
      hasLocation: true,
      tripId,
      lat:              trip.currentLat,
      lng:              trip.currentLng,
      heading:          trip.currentHeading ?? 0,
      speed:            trip.currentSpeed ?? 0,
      locationUpdatedAt: trip.locationUpdatedAt,
    };
  }

  // ── Disponibilité ──────────────────────────────────────────────────────────

  async setAvailability(driverId: string, isAvailable: boolean) {
    return this.prisma.driver.update({
      where: { id: driverId },
      data: { isAvailable },
      select: { id: true, isAvailable: true },
    });
  }
}
