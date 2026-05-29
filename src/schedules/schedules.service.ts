import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dto';
import { CreateClosureDayDto } from './dto/closure.dto';
import dayjs from 'dayjs';

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateScheduleDto) {
    const route = await this.prisma.route.findFirst({
      where: { id: dto.routeId, tenantId },
    });
    if (!route) throw new NotFoundException('Itinéraire introuvable');

    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, tenantId },
      });
      if (!vehicle) throw new NotFoundException('Véhicule introuvable');
    }

    return this.prisma.schedule.create({
      data: {
        tenantId,
        routeId: dto.routeId,
        vehicleId: dto.vehicleId,
        driverId: dto.driverId,
        departureStationId: dto.departureStationId,
        arrivalStationId:   dto.arrivalStationId,
        label: dto.label,
        departureTime: dto.departureTime,
        daysOfWeek: dto.daysOfWeek,
        tripClass: dto.tripClass,
        price: dto.price,
        amenities: dto.amenities ?? [],
        generateDaysAhead: dto.generateDaysAhead ?? 7,
      },
      include: {
        route: true,
        vehicle: true,
        driver: true,
        departureStation: { select: { id: true, name: true } },
        arrivalStation:   { select: { id: true, name: true } },
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.schedule.findMany({
      where: { tenantId },
      include: {
        route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
        vehicle: { select: { plate: true, brand: true, model: true } },
        driver: { select: { firstName: true, lastName: true } },
        departureStation: { select: { id: true, name: true } },
        arrivalStation:   { select: { id: true, name: true } },
        _count: { select: { trips: true } },
      },
      orderBy: [{ isActive: 'desc' }, { departureTime: 'asc' }],
    });
  }

  async findOne(id: string, tenantId: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id },
      include: {
        route: true,
        vehicle: true,
        driver: true,
        departureStation: { select: { id: true, name: true } },
        arrivalStation:   { select: { id: true, name: true } },
        _count: { select: { trips: true } },
      },
    });
    if (!schedule) throw new NotFoundException('Planning introuvable');
    if (schedule.tenantId !== tenantId) throw new ForbiddenException();
    return schedule;
  }

  async update(id: string, tenantId: string, dto: UpdateScheduleDto) {
    const schedule = await this.prisma.schedule.findFirst({ where: { id, tenantId } });
    if (!schedule) throw new NotFoundException('Planning introuvable');

    return this.prisma.schedule.update({
      where: { id },
      data: {
        ...(dto.vehicleId !== undefined && { vehicleId: dto.vehicleId }),
        ...(dto.driverId !== undefined && { driverId: dto.driverId }),
        ...(dto.departureStationId !== undefined && { departureStationId: dto.departureStationId || null }),
        ...(dto.arrivalStationId   !== undefined && { arrivalStationId:   dto.arrivalStationId   || null }),
        ...(dto.label && { label: dto.label }),
        ...(dto.departureTime && { departureTime: dto.departureTime }),
        ...(dto.daysOfWeek && { daysOfWeek: dto.daysOfWeek }),
        ...(dto.tripClass && { tripClass: dto.tripClass }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.amenities !== undefined && { amenities: dto.amenities }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.generateDaysAhead !== undefined && { generateDaysAhead: dto.generateDaysAhead }),
      },
      include: {
        route: true,
        vehicle: true,
        driver: true,
        departureStation: { select: { id: true, name: true } },
        arrivalStation:   { select: { id: true, name: true } },
      },
    });
  }

  async remove(id: string, tenantId: string) {
    const schedule = await this.prisma.schedule.findFirst({ where: { id, tenantId } });
    if (!schedule) throw new NotFoundException('Planning introuvable');
    await this.prisma.schedule.delete({ where: { id } });
  }

  async generateFromSchedule(
    tenantId: string,
    scheduleId: string,
    daysAhead?: number,
  ): Promise<{ created: number; skipped: number }> {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id: scheduleId, tenantId },
      include: { route: true },
    });
    if (!schedule) throw new NotFoundException('Planning introuvable');
    if (!schedule.vehicleId)
      throw new BadRequestException('Aucun véhicule assigné au planning');

    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: schedule.vehicleId },
    });
    if (!vehicle) throw new NotFoundException('Véhicule introuvable');
    if (vehicle.status !== 'ACTIVE')
      throw new BadRequestException('Véhicule indisponible');

    return this._generateForSchedule(schedule, vehicle, daysAhead ?? schedule.generateDaysAhead);
  }

  async generateAll(tenantId: string, daysAhead?: number): Promise<{ created: number; skipped: number }> {
    const schedules = await this.prisma.schedule.findMany({
      where: { tenantId, isActive: true, vehicleId: { not: null } },
      include: { route: true },
    });

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const schedule of schedules) {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: schedule.vehicleId! },
      });
      if (!vehicle || vehicle.status !== 'ACTIVE') { totalSkipped++; continue; }

      const result = await this._generateForSchedule(
        schedule,
        vehicle,
        daysAhead ?? schedule.generateDaysAhead,
      );
      totalCreated += result.created;
      totalSkipped += result.skipped;
    }

    return { created: totalCreated, skipped: totalSkipped };
  }

  // ─── Jours fériés / Fermetures ─────────────────────────────────────────────

  async createClosure(tenantId: string, dto: CreateClosureDayDto) {
    return this.prisma.closureDay.create({
      data: {
        tenantId,
        date: new Date(dto.date),
        label: dto.label,
        isRecurring: dto.isRecurring ?? false,
      },
    });
  }

  async findClosures(tenantId: string) {
    return this.prisma.closureDay.findMany({
      where: { tenantId },
      orderBy: { date: 'asc' },
    });
  }

  /** Liste les jours fériés nationaux CI (tenantId null). */
  async findNationalHolidays() {
    return this.prisma.closureDay.findMany({
      where: { tenantId: null },
      orderBy: { date: 'asc' },
    });
  }

  async removeClosure(id: string, tenantId: string) {
    const closure = await this.prisma.closureDay.findFirst({ where: { id, tenantId } });
    if (!closure) throw new NotFoundException('Fermeture introuvable');
    await this.prisma.closureDay.delete({ where: { id } });
  }

  /** Charge toutes les fermetures applicables à un tenant pour la période. */
  private async loadClosuresForPeriod(
    tenantId: string,
    startDate: dayjs.Dayjs,
    endDate: dayjs.Dayjs,
    includeNational: boolean,
  ): Promise<Set<string>> {
    const where: any = {
      OR: [
        { tenantId, date: { gte: startDate.toDate(), lte: endDate.toDate() } },
        ...(includeNational
          ? [{ tenantId: null, date: { gte: startDate.toDate(), lte: endDate.toDate() } }]
          : []),
      ],
    };

    const closures = await this.prisma.closureDay.findMany({ where });
    const set = new Set<string>();

    for (const c of closures) {
      if (c.isRecurring) {
        // Pour les récurrents, on ajoute tous les MM-DD dans la période
        for (let i = 0; i <= endDate.diff(startDate, 'day'); i++) {
          const d = startDate.add(i, 'day');
          const closureDate = dayjs(c.date);
          if (d.month() === closureDate.month() && d.date() === closureDate.date()) {
            set.add(d.format('YYYY-MM-DD'));
          }
        }
      } else {
        set.add(dayjs(c.date).format('YYYY-MM-DD'));
      }
    }
    return set;
  }

  private async _generateForSchedule(
    schedule: any,
    vehicle: any,
    daysAhead: number,
  ): Promise<{ created: number; skipped: number }> {
    const layout = vehicle.seatLayout as any;
    const seatConfigs: any[] = layout?.seats ?? [];
    const today = dayjs().startOf('day');
    const endDate = today.add(daysAhead - 1, 'day');

    // Charger les fermetures une seule fois pour toute la période
    const closureDates = await this.loadClosuresForPeriod(
      schedule.tenantId,
      today,
      endDate,
      schedule.skipNationalHolidays ?? false,
    );

    let created = 0;
    let skipped = 0;

    for (let i = 0; i < daysAhead; i++) {
      const targetDate = today.add(i, 'day');
      const dayOfWeek = targetDate.day();

      if (!schedule.daysOfWeek.includes(dayOfWeek)) { skipped++; continue; }

      // Vérifier si le jour est fermé
      if (closureDates.has(targetDate.format('YYYY-MM-DD'))) { skipped++; continue; }

      const [hours, minutes] = schedule.departureTime.split(':').map(Number);
      const departureAt = targetDate.hour(hours).minute(minutes).second(0).millisecond(0).toDate();

      const existing = await this.prisma.trip.findFirst({
        where: {
          scheduleId: schedule.id,
          departureAt: {
            gte: targetDate.startOf('day').toDate(),
            lte: targetDate.endOf('day').toDate(),
          },
        },
      });

      if (existing) { skipped++; continue; }

      const estimatedArrivalAt = dayjs(departureAt)
        .add(schedule.route.durationMinutes, 'minute')
        .toDate();

      await this.prisma.trip.create({
        data: {
          tenantId: schedule.tenantId,
          routeId: schedule.routeId,
          vehicleId: schedule.vehicleId,
          driverId: schedule.driverId,
          scheduleId: schedule.id,
          departureAt,
          estimatedArrivalAt,
          price: schedule.price,
          tripClass: schedule.tripClass,
          amenities: schedule.amenities,
          totalSeats: vehicle.capacity,
          availableSeats: vehicle.capacity,
          ...(schedule.departureStationId && { departureStationId: schedule.departureStationId }),
          ...(schedule.arrivalStationId   && { arrivalStationId:   schedule.arrivalStationId   }),
          seats: {
            create: seatConfigs.map((s: any) => ({
              seatNumber: s.number,
              status: 'AVAILABLE',
            })),
          },
        },
      });
      created++;
    }

    return { created, skipped };
  }

  // Génération automatique quotidienne à minuit
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async dailyGeneration() {
    this.logger.log('Génération automatique des voyages planifiés...');
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      select: { id: true },
    });

    let total = 0;
    for (const tenant of tenants) {
      const result = await this.generateAll(tenant.id);
      total += result.created;
    }
    this.logger.log(`Génération terminée : ${total} voyage(s) créé(s)`);
  }
}
