import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTripDto, UpdateTripStatusDto, SearchTripsDto } from './dto/trip.dto';
import { SocketEvent, TripStatus, NotificationType } from '@transpro/shared';
import dayjs from 'dayjs';

@Injectable()
export class TripsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private notifications: NotificationsService,
  ) {}

  async create(tenantId: string, dto: CreateTripDto) {
    const [route, vehicle] = await Promise.all([
      this.prisma.route.findFirst({ where: { id: dto.routeId, tenantId } }),
      this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, tenantId } }),
    ]);

    if (!route) throw new NotFoundException('Itinéraire introuvable');
    if (!vehicle) throw new NotFoundException('Véhicule introuvable');
    if (vehicle.status !== 'ACTIVE') throw new BadRequestException('Véhicule indisponible');

    const layout = vehicle.seatLayout as any;
    const seatConfigs: any[] = layout.seats || [];

    const estimatedArrivalAt = dto.estimatedArrivalAt
      ? new Date(dto.estimatedArrivalAt)
      : dayjs(dto.departureAt).add(route.durationMinutes, 'minute').toDate();

    const trip = await this.prisma.trip.create({
      data: {
        tenantId,
        routeId: dto.routeId,
        vehicleId: dto.vehicleId,
        driverId: dto.driverId,
        departureAt: new Date(dto.departureAt),
        estimatedArrivalAt,
        price: dto.price,
        tripClass: dto.tripClass ?? 'STANDARD',
        amenities: dto.amenities ?? [],
        totalSeats: vehicle.capacity,
        availableSeats: vehicle.capacity,
        ...(dto.departureStationId && { departureStationId: dto.departureStationId }),
        ...(dto.arrivalStationId && { arrivalStationId: dto.arrivalStationId }),
        seats: {
          create: seatConfigs.map((seat: any) => ({
            seatNumber: seat.number,
            status: 'AVAILABLE',
          })),
        },
      },
      include: {
        route: true,
        vehicle: { select: { plate: true, brand: true, model: true, capacity: true } },
        driver: { select: { firstName: true, lastName: true, phone: true } },
        seats: true,
      },
    });

    return trip;
  }

  async findAll(tenantId: string, filters: { status?: TripStatus; routeId?: string; date?: string; tripClass?: string }) {
    const where: any = { tenantId };

    if (filters.status) where.status = filters.status;
    if (filters.routeId) where.routeId = filters.routeId;
    if (filters.tripClass) where.tripClass = filters.tripClass;
    if (filters.date) {
      const start = dayjs(filters.date).startOf('day').toDate();
      const end = dayjs(filters.date).endOf('day').toDate();
      where.departureAt = { gte: start, lte: end };
    }

    return this.prisma.trip.findMany({
      where,
      include: {
        route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
        vehicle: { select: { plate: true, brand: true, model: true } },
        driver: { select: { firstName: true, lastName: true } },
        _count: { select: { bookings: true } },
      },
      orderBy: { departureAt: 'asc' },
    });
  }

  async findOne(id: string, tenantId?: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        route: { include: { stops: { orderBy: { order: 'asc' } } } },
        vehicle: true,
        driver: true,
        seats: { orderBy: { seatNumber: 'asc' } },
      },
    });

    if (!trip) throw new NotFoundException('Voyage introuvable');
    if (tenantId && trip.tenantId !== tenantId) throw new ForbiddenException();

    return trip;
  }

  async getSeats(tripId: string) {
    const seats = await this.prisma.tripSeat.findMany({
      where: { tripId },
      orderBy: { seatNumber: 'asc' },
    });
    return seats;
  }

  async updateStatus(id: string, tenantId: string, dto: UpdateTripStatusDto) {
    const trip = await this.prisma.trip.findFirst({ where: { id, tenantId } });
    if (!trip) throw new NotFoundException('Voyage introuvable');

    const updated = await this.prisma.trip.update({
      where: { id },
      data: {
        status: dto.status,
        delayMinutes: dto.delayMinutes ?? trip.delayMinutes,
        notes: dto.notes ?? trip.notes,
        ...(dto.status === 'DEPARTED' && { actualDepartureAt: new Date() }),
        ...(dto.status === 'ARRIVED' && { actualArrivalAt: new Date() }),
      },
    });

    // Fetch the full trip to broadcast rich data for real-time tracking.
    const fullTrip = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        route: {
          select: {
            name: true,
            originCity: { select: { name: true } },
            destinationCity: { select: { name: true } },
          },
        },
        vehicle: { select: { plate: true, brand: true, model: true } },
        driver: { select: { firstName: true, lastName: true } },
      },
    });

    // Broadcast temps réel
    this.realtime.broadcastToTrip(id, SocketEvent.TRIP_STATUS_CHANGED, {
      tripId: id,
      status: dto.status,
      delayMinutes: dto.delayMinutes,
      message: dto.notes,
      trip: fullTrip,
    });

    this.realtime.broadcastToCompany(tenantId, SocketEvent.TRIP_STATUS_CHANGED, {
      tripId: id,
      status: dto.status,
      trip: { id, status: dto.status },
    });

    if (dto.status === 'CANCELLED' || (dto.delayMinutes && dto.delayMinutes > 0)) {
      const activeBookings = await this.prisma.booking.findMany({
        where: { tripId: id, status: { in: ['PENDING', 'CONFIRMED'] } },
        select: { passengerId: true, id: true },
      });

      const isCancelled = dto.status === 'CANCELLED';
      const type = isCancelled ? NotificationType.TRIP_CANCELLED : NotificationType.TRIP_DELAYED;
      const title = isCancelled ? 'Voyage annulé' : 'Voyage retardé';
      const message = isCancelled
        ? `Votre voyage a été annulé. Contactez la compagnie pour plus d'informations.`
        : `Votre voyage est retardé de ${dto.delayMinutes} minutes.${dto.notes ? ' ' + dto.notes : ''}`;

      await Promise.all(
        activeBookings.map((b) =>
          this.notifications.create({
            userId: b.passengerId,
            type,
            title,
            message,
            data: { tripId: id, bookingId: b.id },
          }).catch(() => {}),
        ),
      );
    }

    return updated;
  }

  async toggleSeatBlock(tripId: string, tenantId: string, seatNumber: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId } });
    if (!trip) throw new NotFoundException('Voyage introuvable');

    const seat = await this.prisma.tripSeat.findUnique({
      where: { tripId_seatNumber: { tripId, seatNumber } },
    });
    if (!seat) throw new NotFoundException('Siège introuvable');

    if (seat.status === 'RESERVED' || seat.status === 'OCCUPIED') {
      throw new BadRequestException('Impossible de modifier un siège réservé ou occupé');
    }

    const newStatus = seat.status === 'AVAILABLE' ? 'BLOCKED' : 'AVAILABLE';
    const updated = await this.prisma.tripSeat.update({
      where: { id: seat.id },
      data: { status: newStatus },
    });

    this.realtime.broadcastToTrip(tripId, SocketEvent.SEAT_UPDATED, {
      tripId,
      seatNumber,
      status: newStatus,
    });

    return updated;
  }

  async getSeatBooking(tripId: string, tenantId: string, seatNumber: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId } });
    if (!trip) throw new NotFoundException('Voyage introuvable');

    const booking = await this.prisma.booking.findFirst({
      where: {
        tripId,
        seatNumbers: { has: seatNumber },
        status: { in: ['CONFIRMED', 'PENDING'] },
      },
      select: {
        id: true,
        reference: true,
        status: true,
        totalAmount: true,
        confirmedAt: true,
        passenger: { select: { firstName: true, lastName: true, phone: true, email: true } },
        payment: { select: { method: true, status: true, paidAt: true } },
      },
    });

    return booking;
  }

  async search(dto: SearchTripsDto) {
    const start = dayjs(dto.departureDate).startOf('day').toDate();
    const end = dayjs(dto.departureDate).endOf('day').toDate();

    const where: any = {
      status: { in: ['SCHEDULED', 'BOARDING'] },
      departureAt: { gte: start, lte: end },
      availableSeats: { gte: dto.passengers ?? 1 },
      route: {
        originCity: { name: { contains: dto.origin, mode: 'insensitive' } },
        destinationCity: { name: { contains: dto.destination, mode: 'insensitive' } },
        isActive: true,
      },
    };

    if (dto.tripClass) where.tripClass = dto.tripClass;

    const trips = await this.prisma.trip.findMany({
      where,
      include: {
        route: {
          select: {
            name: true,
            originCity: { select: { name: true } },
            destinationCity: { select: { name: true } },
            durationMinutes: true,
          },
        },
        vehicle: { select: { brand: true, model: true, capacity: true } },
        tenant: { select: { name: true, logo: true, slug: true } },
      },
      orderBy: [{ tripClass: 'asc' }, { departureAt: 'asc' }],
    });

    return trips;
  }
}
