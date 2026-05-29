import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStationDto, UpdateStationDto, AssignMemberDto } from './dto/station.dto';
import dayjs from 'dayjs';

@Injectable()
export class StationsService {
  constructor(private prisma: PrismaService) {}

  async findByCity(cityName: string) {
    return this.prisma.station.findMany({
      where: {
        isActive: true,
        city: { name: { contains: cityName, mode: 'insensitive' } },
      },
      select: {
        id: true,
        name: true,
        address: true,
        code: true,
        latitude: true,
        longitude: true,
        city: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true, slug: true, logo: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findPublicInfo(stationId: string) {
    const station = await this.prisma.station.findFirst({
      where: { id: stationId, isActive: true },
      select: {
        id: true, name: true, address: true, phone: true, code: true,
        latitude: true, longitude: true,
        city: { select: { id: true, name: true, region: true } },
        tenant: { select: { id: true, name: true, slug: true, logo: true, phone: true } },
      },
    });

    if (!station) throw new NotFoundException('Gare introuvable');

    const now = new Date();
    const tomorrow = dayjs().add(1, 'day').endOf('day').toDate();

    const upcomingDepartures = await this.prisma.trip.findMany({
      where: {
        departureStationId: stationId,
        status: { in: ['SCHEDULED', 'BOARDING'] },
        departureAt: { gte: now, lte: tomorrow },
        availableSeats: { gt: 0 },
      },
      select: {
        id: true,
        departureAt: true,
        price: true,
        tripClass: true,
        availableSeats: true,
        route: {
          select: {
            name: true,
            originCity: { select: { name: true } },
            destinationCity: { select: { name: true } },
          },
        },
      },
      orderBy: { departureAt: 'asc' },
      take: 10,
    });

    const totalDepartures = await this.prisma.trip.count({
      where: { departureStationId: stationId },
    });

    return { ...station, upcomingDepartures, totalDepartures };
  }

  async create(tenantId: string, dto: CreateStationDto) {
    return this.prisma.station.create({
      data: { ...dto, tenantId },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.station.findMany({
      where: { tenantId },
      include: {
        city: { select: { id: true, name: true } },
        _count: { select: { userStations: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const station = await this.prisma.station.findFirst({
      where: { id, tenantId },
      include: {
        city: { select: { id: true, name: true } },
        userStations: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true } },
          },
        },
      },
    });
    if (!station) throw new NotFoundException('Gare introuvable');
    return station;
  }

  async update(id: string, tenantId: string, dto: UpdateStationDto) {
    await this.findOne(id, tenantId);
    return this.prisma.station.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    await this.prisma.station.delete({ where: { id } });
    return { message: 'Gare supprimée' };
  }

  async getMembers(stationId: string, tenantId: string) {
    await this.findOne(stationId, tenantId);
    return this.prisma.userStation.findMany({
      where: { stationId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true } },
      },
    });
  }

  async assignMember(stationId: string, tenantId: string, dto: AssignMemberDto) {
    await this.findOne(stationId, tenantId);

    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, tenantId },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const existing = await this.prisma.userStation.findUnique({
      where: { userId_stationId: { userId: dto.userId, stationId } },
    });
    if (existing) throw new ConflictException('Cet utilisateur est déjà affecté à cette gare');

    if (dto.isPrimary) {
      await this.prisma.userStation.updateMany({
        where: { userId: dto.userId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.userStation.create({
      data: { userId: dto.userId, stationId, isPrimary: dto.isPrimary ?? false },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        station: { select: { id: true, name: true, city: { select: { name: true } } } },
      },
    });
  }

  async removeMember(stationId: string, userId: string, tenantId: string) {
    await this.findOne(stationId, tenantId);
    const link = await this.prisma.userStation.findUnique({
      where: { userId_stationId: { userId, stationId } },
    });
    if (!link) throw new NotFoundException('Affectation introuvable');
    await this.prisma.userStation.delete({
      where: { userId_stationId: { userId, stationId } },
    });
    return { message: 'Affectation supprimée' };
  }

  async verifyAccess(stationId: string, userId: string, tenantId: string) {
    const station = await this.prisma.station.findFirst({ where: { id: stationId, tenantId } });
    if (!station) throw new NotFoundException('Gare introuvable');
    const link = await this.prisma.userStation.findUnique({
      where: { userId_stationId: { userId, stationId } },
    });
    if (!link) throw new ForbiddenException('Accès à cette gare refusé');
    return station;
  }

  async getDashboard(stationId: string, tenantId: string) {
    const today = dayjs().startOf('day').toDate();
    const tomorrow = dayjs().add(1, 'day').startOf('day').toDate();

    const [todayTrips, todayBookings, todayRevenue] = await Promise.all([
      this.prisma.trip.count({
        where: {
          tenantId,
          departureStationId: stationId,
          departureAt: { gte: today, lt: tomorrow },
        },
      }),
      this.prisma.booking.count({
        where: {
          tenantId,
          soldByStationId: stationId,
          createdAt: { gte: today, lt: tomorrow },
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          tenantId,
          status: 'SUCCESS',
          booking: { soldByStationId: stationId },
          paidAt: { gte: today, lt: tomorrow },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      todayTrips,
      todayBookings,
      todayRevenue: todayRevenue._sum.amount ?? 0,
    };
  }

  async getTodayTrips(stationId: string, tenantId: string, date?: string) {
    const target = date ? dayjs(date) : dayjs();
    const today = target.startOf('day').toDate();
    const tomorrow = target.add(1, 'day').startOf('day').toDate();

    return this.prisma.trip.findMany({
      where: {
        tenantId,
        departureStationId: stationId,
        departureAt: { gte: today, lt: tomorrow },
      },
      include: {
        route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
        vehicle: { select: { plate: true, brand: true, model: true, capacity: true } },
        driver: { select: { firstName: true, lastName: true } },
        _count: { select: { bookings: true } },
      },
      orderBy: { departureAt: 'asc' },
    });
  }

  async getAnalytics(stationId: string, tenantId: string, days = 30) {
    const endDate = dayjs().endOf('day');
    const startDate = endDate.subtract(days - 1, 'day').startOf('day');

    const [payments, bookings, trips] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          tenantId, status: 'SUCCESS',
          paidAt: { gte: startDate.toDate(), lte: endDate.toDate() },
          booking: { soldByStationId: stationId },
        },
        select: { amount: true, paidAt: true, method: true },
      }),
      this.prisma.booking.findMany({
        where: {
          tenantId, soldByStationId: stationId,
          createdAt: { gte: startDate.toDate(), lte: endDate.toDate() },
        },
        select: { createdAt: true, status: true, totalAmount: true, trip: { select: { route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } } } },
      }),
      this.prisma.trip.findMany({
        where: {
          tenantId, departureStationId: stationId,
          departureAt: { gte: startDate.toDate(), lte: endDate.toDate() },
        },
        select: { departureAt: true, totalSeats: true, availableSeats: true, status: true },
      }),
    ]);

    // Revenue + bookings per day
    const trend = Array.from({ length: days }, (_, i) => {
      const d = startDate.add(i, 'day');
      const ds = d.startOf('day').toDate();
      const de = d.endOf('day').toDate();
      const revenue = payments
        .filter(p => p.paidAt && p.paidAt >= ds && p.paidAt <= de)
        .reduce((s, p) => s + p.amount, 0);
      const count = bookings.filter(b => b.createdAt >= ds && b.createdAt <= de).length;
      return { date: d.format('YYYY-MM-DD'), label: d.format('DD/MM'), revenue, count };
    });

    // Top routes
    const routeMap: Record<string, { label: string; count: number; revenue: number }> = {};
    for (const b of bookings) {
      const key = `${(b.trip?.route?.originCity as any)?.name ?? '?'} → ${(b.trip?.route?.destinationCity as any)?.name ?? '?'}`;
      if (!routeMap[key]) routeMap[key] = { label: key, count: 0, revenue: 0 };
      routeMap[key].count += 1;
      routeMap[key].revenue += b.totalAmount;
    }
    const topRoutes = Object.values(routeMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Payment method breakdown
    const byMethod: Record<string, number> = {};
    for (const p of payments) {
      byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    }

    // Aggregates
    const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
    const totalBookings = bookings.length;
    const confirmed = bookings.filter(b => b.status === 'CONFIRMED' || b.status === 'COMPLETED').length;
    const cancelled = bookings.filter(b => b.status === 'CANCELLED').length;
    const conversionRate = totalBookings > 0 ? Math.round((confirmed / totalBookings) * 100) : 0;

    // Average occupancy on departed trips
    const departedTrips = trips.filter(t => t.status === 'DEPARTED' || t.status === 'ARRIVED');
    const avgOccupancy = departedTrips.length > 0
      ? Math.round(departedTrips.reduce((s, t) => s + ((t.totalSeats - t.availableSeats) / t.totalSeats), 0) / departedTrips.length * 100)
      : 0;

    return {
      period: { start: startDate.format('YYYY-MM-DD'), end: endDate.format('YYYY-MM-DD'), days },
      totals: { revenue: totalRevenue, bookings: totalBookings, confirmed, cancelled, conversionRate, avgOccupancy },
      trend,
      topRoutes,
      byMethod,
    };
  }

  async getBookings(
    stationId: string,
    tenantId: string,
    params?: { status?: string; page?: number; limit?: number; search?: string },
  ) {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const where: any = { tenantId, soldByStationId: stationId };
    if (params?.status) where.status = params.status;
    if (params?.search) {
      const q = params.search.toLowerCase();
      where.OR = [
        { reference: { contains: q, mode: 'insensitive' } },
        { passenger: { firstName: { contains: q, mode: 'insensitive' } } },
        { passenger: { lastName: { contains: q, mode: 'insensitive' } } },
        { passenger: { phone: { contains: q } } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: {
          passenger: { select: { firstName: true, lastName: true, phone: true } },
          trip: {
            include: {
              route: {
                select: {
                  originCity: { select: { name: true } },
                  destinationCity: { select: { name: true } },
                },
              },
            },
          },
          tickets: { select: { seatNumber: true, qrCode: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getCaisse(stationId: string, tenantId: string, date?: string) {
    const targetDate = date ? dayjs(date) : dayjs();
    const start = targetDate.startOf('day').toDate();
    const end = targetDate.add(1, 'day').startOf('day').toDate();

    const bookings = await this.prisma.booking.findMany({
      where: {
        tenantId,
        soldByStationId: stationId,
        createdAt: { gte: start, lt: end },
      },
      include: {
        passenger: { select: { firstName: true, lastName: true, phone: true } },
        trip: {
          include: { route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } },
        },
        payment: { select: { method: true, status: true, amount: true, paidAt: true } },
        tickets: { select: { seatNumber: true, isScanned: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalRevenue = bookings
      .filter((b) => b.payment?.status === 'SUCCESS')
      .reduce((sum, b) => sum + (b.payment?.amount ?? 0), 0);

    const byMethod: Record<string, number> = {};
    for (const b of bookings) {
      if (b.payment?.status === 'SUCCESS' && b.payment.method) {
        byMethod[b.payment.method] = (byMethod[b.payment.method] ?? 0) + (b.payment.amount ?? 0);
      }
    }

    return { bookings, totalRevenue, byMethod, date: targetDate.format('YYYY-MM-DD') };
  }
}
