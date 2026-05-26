import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../common/repositories/base.repository';
import { PrismaService } from '../prisma/prisma.service';
import { TripStatus, PaginatedResult, PaginationQuery } from '@transpro/shared';
import { Prisma } from '@transpro/database';
import dayjs from 'dayjs';

@Injectable()
export class TripsRepository extends BaseRepository<any> {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(id: string) {
    return this.prisma.trip.findUnique({
      where: { id },
      include: {
        route: { include: { stops: { orderBy: { order: 'asc' } } } },
        vehicle: true,
        driver: true,
        seats: { orderBy: { seatNumber: 'asc' } },
        tenant: { select: { name: true, logo: true } },
      },
    });
  }

  async findByTenant(
    tenantId: string,
    filters: { status?: TripStatus; routeId?: string; date?: string },
    query: PaginationQuery = {},
  ): Promise<PaginatedResult<any>> {
    const { skip, take } = this.paginate(query.page, query.limit);

    const where: Prisma.TripWhereInput = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.routeId) where.routeId = filters.routeId;
    if (filters.date) {
      where.departureAt = {
        gte: dayjs(filters.date).startOf('day').toDate(),
        lte: dayjs(filters.date).endOf('day').toDate(),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        skip,
        take,
        include: {
          route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
          vehicle: { select: { plate: true, brand: true, model: true } },
          driver: { select: { firstName: true, lastName: true } },
          _count: { select: { bookings: true } },
        },
        orderBy: { departureAt: 'asc' },
      }),
      this.prisma.trip.count({ where }),
    ]);

    return { data, meta: this.buildPaginationMeta(total, query.page ?? 1, take) };
  }

  async search(params: {
    origin: string;
    destination: string;
    date: string;
    passengers: number;
  }) {
    const start = dayjs(params.date).startOf('day').toDate();
    const end = dayjs(params.date).endOf('day').toDate();

    return this.prisma.trip.findMany({
      where: {
        status: { in: ['SCHEDULED', 'BOARDING'] },
        departureAt: { gte: start, lte: end },
        availableSeats: { gte: params.passengers },
        route: {
          originCity: { name: { contains: params.origin, mode: 'insensitive' } },
          destinationCity: { name: { contains: params.destination, mode: 'insensitive' } },
          isActive: true,
        },
      },
      include: {
        route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } }, durationMinutes: true } },
        vehicle: { select: { brand: true, model: true, capacity: true } },
        tenant: { select: { name: true, logo: true } },
      },
      orderBy: { departureAt: 'asc' },
    });
  }

  async updateStatus(id: string, status: TripStatus, extra: Record<string, any> = {}) {
    return this.prisma.trip.update({
      where: { id },
      data: {
        status,
        ...extra,
        ...(status === 'DEPARTED' && { actualDepartureAt: new Date() }),
        ...(status === 'ARRIVED' && { actualArrivalAt: new Date() }),
      },
    });
  }

  async decrementAvailableSeats(id: string, count: number) {
    return this.prisma.trip.update({
      where: { id },
      data: { availableSeats: { decrement: count } },
    });
  }

  async incrementAvailableSeats(id: string, count: number) {
    return this.prisma.trip.update({
      where: { id },
      data: { availableSeats: { increment: count } },
    });
  }
}
