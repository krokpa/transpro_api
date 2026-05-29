import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import { CreateTripDto, UpdateTripStatusDto, SearchTripsDto } from './dto/trip.dto';
import { SocketEvent, TripStatus, NotificationType } from '@transpro/shared';
import dayjs from 'dayjs';

@Injectable()
export class TripsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private notifications: NotificationsService,
    private push: PushService,
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
        ...(dto.advancedSeatManagement !== undefined && { advancedSeatManagement: dto.advancedSeatManagement }),
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

  async findAll(tenantId: string, filters: { status?: TripStatus; routeId?: string; date?: string; tripClass?: string; stationId?: string | null }) {
    const where: any = { tenantId };

    if (filters.status) where.status = filters.status;
    if (filters.routeId) where.routeId = filters.routeId;
    if (filters.tripClass) where.tripClass = filters.tripClass;
    if (filters.stationId) where.departureStationId = filters.stationId;
    if (filters.date) {
      const start = dayjs(filters.date).startOf('day').toDate();
      const end = dayjs(filters.date).endOf('day').toDate();
      where.departureAt = { gte: start, lte: end };
    }

    return this.prisma.trip.findMany({
      where,
      include: {
        route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
        vehicle: { select: { plate: true, brand: true, model: true, advancedSeatManagement: true } },
        driver: { select: { firstName: true, lastName: true } },
        departureStation: { select: { id: true, name: true, address: true, city: { select: { name: true } } } },
        arrivalStation: { select: { id: true, name: true, address: true, city: { select: { name: true } } } },
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
        departureStation: { select: { id: true, name: true, address: true, city: { select: { name: true } } } },
        arrivalStation: { select: { id: true, name: true, address: true, city: { select: { name: true } } } },
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
        tenant: { select: { logo: true } },
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

    const logoUrl: string | undefined = (fullTrip as any)?.tenant?.logo?.startsWith('http')
      ? (fullTrip as any).tenant.logo
      : undefined;

    if (dto.status === 'CANCELLED' || (dto.delayMinutes && dto.delayMinutes > 0)) {
      const activeBookings = await this.prisma.booking.findMany({
        where: { tripId: id, status: { in: ['PENDING', 'CONFIRMED'] } },
        select: {
          passengerId: true, id: true, seatNumbers: true, tripId: true, totalAmount: true,
          payment: { select: { id: true, status: true } },
        },
      });

      const isCancelled = dto.status === 'CANCELLED';

      if (isCancelled && activeBookings.length > 0) {
        // Cascade : annuler toutes les réservations actives et libérer les sièges
        await Promise.all(
          activeBookings.map((booking) =>
            this.prisma.$transaction(async (tx) => {
              await tx.booking.update({
                where: { id: booking.id },
                data: { status: 'CANCELLED', cancelReason: 'Voyage annulé par la compagnie' },
              });
              await tx.tripSeat.updateMany({
                where: { tripId: booking.tripId, seatNumber: { in: booking.seatNumbers } },
                data: { status: 'AVAILABLE', bookingId: null, lockedAt: null, lockedBy: null },
              });
              await tx.trip.update({
                where: { id: booking.tripId },
                data: { availableSeats: { increment: booking.seatNumbers.length } },
              });
            }),
          ),
        );

        // Broadcast libération des sièges en temps réel
        for (const booking of activeBookings) {
          for (const seatNumber of booking.seatNumbers) {
            this.realtime.broadcastToTrip(id, SocketEvent.SEAT_UPDATED, {
              tripId: id, seatNumber, status: 'AVAILABLE',
            });
          }
        }

        // Créer des demandes de remboursement pour les réservations payées
        const paidBookings = activeBookings.filter(
          (b) => b.payment?.status === 'SUCCESS',
        );
        if (paidBookings.length > 0) {
          await this.prisma.refund.createMany({
            data: paidBookings.map((b) => ({
              paymentId: b.payment!.id,
              bookingId: b.id,
              tenantId,
              amount: b.totalAmount,
              reason: 'Voyage annulé par la compagnie',
            })),
            skipDuplicates: true,
          });
        }
      }

      // Web push dashboard : notifier le staff de la compagnie
      const staffMsg = isCancelled
        ? `Voyage annulé — ${activeBookings.length} réservation(s) impactée(s)`
        : `Retard de ${dto.delayMinutes} min sur un voyage`;
      this.push.sendWebPushToTenant(tenantId, {
        title: isCancelled ? 'Voyage annulé' : 'Retard signalé',
        message: staffMsg,
        data: { type: isCancelled ? 'TRIP_CANCELLED' : 'TRIP_DELAYED', tripId: id },
      }).catch(() => {});

      const type = isCancelled ? NotificationType.TRIP_CANCELLED : NotificationType.TRIP_DELAYED;
      const templateData: Record<string, string> = isCancelled
        ? {}
        : { delayMinutes: String(dto.delayMinutes ?? 0), notes: dto.notes ?? '' };

      await Promise.all(
        activeBookings.map((b) =>
          this.notifications.create({
            userId: b.passengerId,
            type,
            templateData,
            data: { tripId: id, bookingId: b.id },
            companyLogo: logoUrl,
          }).catch(() => {}),
        ),
      );
    }

    if (dto.status === 'DEPARTED' || dto.status === 'ARRIVED') {
      const confirmedBookings = await this.prisma.booking.findMany({
        where: { tripId: id, status: 'CONFIRMED' },
        select: { passengerId: true, id: true },
      });

      const origin = (fullTrip as any)?.route?.originCity?.name ?? '';
      const dest   = (fullTrip as any)?.route?.destinationCity?.name ?? '';
      const type   = dto.status === 'DEPARTED' ? NotificationType.TRIP_DEPARTED : NotificationType.TRIP_ARRIVED;

      await Promise.all(
        confirmedBookings.map((b) =>
          this.notifications.create({
            userId: b.passengerId,
            type,
            templateData: { origin, destination: dest },
            data: { tripId: id, bookingId: b.id },
            companyLogo: logoUrl,
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

  async upcoming(limit = 10) {
    const now = new Date();
    return this.prisma.trip.findMany({
      where: {
        status: { in: ['SCHEDULED', 'BOARDING'] },
        departureAt: { gte: now },
        availableSeats: { gt: 0 },
      },
      include: {
        route: {
          select: {
            name: true,
            originCity: { select: { name: true } },
            destinationCity: { select: { name: true } },
            durationMinutes: true,
          },
        },
        vehicle: { select: { brand: true, model: true, capacity: true, advancedSeatManagement: true } },
        tenant: { select: { name: true, logo: true, slug: true } },
        departureStation: { select: { id: true, name: true, address: true, city: { select: { name: true } } } },
        arrivalStation: { select: { id: true, name: true, address: true, city: { select: { name: true } } } },
      },
      orderBy: { departureAt: 'asc' },
      take: limit,
    });
  }

  async manifest(tripId: string, tenantId: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId } });
    if (!trip) throw new NotFoundException('Voyage introuvable');

    const bookings = await this.prisma.booking.findMany({
      where: { tripId, status: { in: ['CONFIRMED', 'PENDING'] } },
      include: {
        passenger: { select: { id: true, firstName: true, lastName: true, phone: true } },
        tickets: {
          select: { id: true, seatNumber: true, isScanned: true, scannedAt: true, qrCodeData: true },
          orderBy: { seatNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return bookings.map((b) => ({
      id:            b.id,
      reference:     b.reference,
      status:        b.status,
      user: {
        firstName: b.passenger.firstName,
        lastName:  b.passenger.lastName,
        phone:     b.passenger.phone,
      },
      tickets: b.tickets.map((t) => ({
        id:           t.id,
        seatNumber:   t.seatNumber,
        checkedInAt:  t.scannedAt?.toISOString() ?? null,
        qrCodeData:   t.qrCodeData,
      })),
    }));
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
    if (dto.tenantSlug) where.tenant = { slug: dto.tenantSlug };
    if (dto.departureStationId) where.departureStationId = dto.departureStationId;

    const trips = await this.prisma.trip.findMany({
      where,
      include: {
        route: {
          select: {
            name: true,
            originCity: { select: { name: true } },
            destinationCity: { select: { name: true } },
            durationMinutes: true,
            stops: {
              orderBy: { order: 'asc' },
              select: {
                order: true,
                durationFromOriginMinutes: true,
                priceFromOrigin: true,
                city: { select: { name: true } },
              },
            },
          },
        },
        vehicle: { select: { brand: true, model: true, capacity: true, advancedSeatManagement: true } },
        tenant: { select: { name: true, logo: true, slug: true } },
        departureStation: { select: { id: true, name: true, address: true, city: { select: { name: true } } } },
        arrivalStation: { select: { id: true, name: true, address: true, city: { select: { name: true } } } },
      },
      orderBy: [{ tripClass: 'asc' }, { departureAt: 'asc' }],
    });

    return trips;
  }
}
