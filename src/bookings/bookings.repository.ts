import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../common/repositories/base.repository';
import { PrismaService } from '../prisma/prisma.service';
import { BookingStatus, PaginatedResult, PaginationQuery } from '@transpro/shared';
import { Prisma } from '@transpro/database';

@Injectable()
export class BookingsRepository extends BaseRepository<any> {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(id: string) {
    return this.prisma.booking.findUnique({
      where: { id },
      include: {
        trip: { include: { route: true, vehicle: true } },
        passenger: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        payment: true,
        tickets: true,
        seats: true,
      },
    });
  }

  async findByReference(reference: string) {
    return this.prisma.booking.findUnique({ where: { reference } });
  }

  async findByPassenger(passengerId: string, query: PaginationQuery = {}): Promise<PaginatedResult<any>> {
    const { skip, take } = this.paginate(query.page, query.limit);

    const where: Prisma.BookingWhereInput = { passengerId };
    if (query.search) {
      where.reference = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take,
        include: {
          trip: {
            include: {
              route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
              tenant: { select: { name: true, logo: true } },
            },
          },
          tickets: true,
          payment: { select: { method: true, status: true, paidAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return { data, meta: this.buildPaginationMeta(total, query.page ?? 1, take) };
  }

  async findByTenant(
    tenantId: string,
    filters: { status?: BookingStatus; tripId?: string },
    query: PaginationQuery = {},
  ): Promise<PaginatedResult<any>> {
    const { skip, take } = this.paginate(query.page, query.limit);

    const where: Prisma.BookingWhereInput = {
      tenantId,
      ...(filters.status && { status: filters.status }),
      ...(filters.tripId && { tripId: filters.tripId }),
    };

    if (query.search) {
      where.OR = [
        { reference: { contains: query.search, mode: 'insensitive' } },
        { passenger: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { passenger: { lastName: { contains: query.search, mode: 'insensitive' } } },
        { passenger: { phone: { contains: query.search } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take,
        include: {
          passenger: { select: { firstName: true, lastName: true, phone: true, email: true } },
          trip: {
            include: { route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } },
          },
          tickets: true,
          payment: { select: { method: true, status: true, amount: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return { data, meta: this.buildPaginationMeta(total, query.page ?? 1, take) };
  }

  async countExpired(): Promise<number> {
    return this.prisma.booking.count({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    });
  }

  async findExpired() {
    return this.prisma.booking.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      select: { id: true, tripId: true, passengerId: true, tenantId: true, seatNumbers: true },
    });
  }

  async findTripSeats(tripId: string) {
    return this.prisma.tripSeat.findMany({
      where: { tripId },
      orderBy: { seatNumber: 'asc' },
    });
  }

  async findSeatsForUpdate(tripId: string, seatNumbers: string[]) {
    return this.prisma.tripSeat.findMany({
      where: { tripId, seatNumber: { in: seatNumbers } },
    });
  }
}
