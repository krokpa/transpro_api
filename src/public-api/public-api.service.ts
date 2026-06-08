import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicApiService {
  constructor(private prisma: PrismaService) {}

  // ── Voyages ────────────────────────────────────────────────────────────────

  async searchTrips(params: {
    origin:        string;
    destination:   string;
    departureDate: string;
    passengers?:   number;
    tenantId?:     string;
  }) {
    const date   = new Date(params.departureDate);
    if (isNaN(date.getTime())) throw new BadRequestException('departureDate invalide (YYYY-MM-DD)');

    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    return this.prisma.trip.findMany({
      where: {
        status:      { in: ['SCHEDULED', 'BOARDING'] },
        departureAt: { gte: dayStart, lte: dayEnd },
        ...(params.tenantId ? { tenantId: params.tenantId } : {}),
        route: {
          isActive:        true,
          originCity:      { name: { contains: params.origin,      mode: 'insensitive' } },
          destinationCity: { name: { contains: params.destination, mode: 'insensitive' } },
        },
        availableSeats: { gte: params.passengers ?? 1 },
      },
      select: {
        id: true, departureAt: true, estimatedArrivalAt: true,
        status: true, price: true, availableSeats: true, totalSeats: true,
        route: {
          select: {
            id: true, name: true, distanceKm: true, durationMinutes: true,
            originCity:      { select: { name: true } },
            destinationCity: { select: { name: true } },
          },
        },
        vehicle: { select: { brand: true, model: true, capacity: true } },
        tenant: { select: { id: true, name: true, slug: true, logo: true } },
      },
      orderBy: { departureAt: 'asc' },
      take: 50,
    });
  }

  async getTrip(id: string, tenantId?: string) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id,
        status: { in: ['SCHEDULED', 'BOARDING', 'DEPARTED'] },
        ...(tenantId ? { tenantId } : {}),
      },
      select: {
        id: true, departureAt: true, estimatedArrivalAt: true,
        status: true, price: true, availableSeats: true, totalSeats: true,
        route: {
          select: {
            id: true, name: true, distanceKm: true, durationMinutes: true,
            originCity:      { select: { name: true } },
            destinationCity: { select: { name: true } },
            stops: {
              select: { order: true, durationFromOriginMinutes: true, priceFromOrigin: true, city: { select: { name: true } } },
              orderBy: { order: 'asc' },
            },
          },
        },
        vehicle: { select: { brand: true, model: true, capacity: true } },
        tenant:  { select: { id: true, name: true, slug: true, logo: true, phone: true } },
      },
    });

    if (!trip) throw new NotFoundException('Voyage introuvable ou non disponible');
    return trip;
  }

  // ── Gares & Itinéraires ────────────────────────────────────────────────────

  async listStations(tenantId?: string) {
    return this.prisma.station.findMany({
      where: { isActive: true, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true, name: true, code: true, address: true, latitude: true, longitude: true,
        city:   { select: { name: true, region: true } },
        tenant: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ tenant: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async listRoutes(tenantId?: string) {
    return this.prisma.route.findMany({
      where: { isActive: true, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true, name: true, distanceKm: true, durationMinutes: true, basePrice: true,
        originCity:      { select: { name: true } },
        destinationCity: { select: { name: true } },
        tenant:          { select: { id: true, name: true, slug: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ── Réservations ───────────────────────────────────────────────────────────

  async createBooking(dto: {
    tripId:          string;
    passengerPhone:  string;
    passengerEmail?: string;
    passengerName:   string;
    seatNumbers:     string[];
    tenantId?:       string;
  }) {
    // Charger le voyage
    const trip = await this.prisma.trip.findFirst({
      where: {
        id:     dto.tripId,
        status: { in: ['SCHEDULED', 'BOARDING'] },
        ...(dto.tenantId ? { tenantId: dto.tenantId } : {}),
      },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable ou non réservable');

    if (trip.availableSeats < dto.seatNumbers.length) {
      throw new BadRequestException('Places insuffisantes sur ce voyage');
    }

    // Trouver ou créer le passager
    let passenger = await this.prisma.user.findUnique({ where: { phone: dto.passengerPhone } });
    if (!passenger) {
      const [firstName, ...lastParts] = dto.passengerName.trim().split(' ');
      passenger = await this.prisma.user.create({
        data: {
          phone:     dto.passengerPhone,
          email:     dto.passengerEmail ?? `ext_${dto.passengerPhone.replace(/\D/g, '')}@api.transpro.ci`,
          firstName: firstName ?? dto.passengerName,
          lastName:  lastParts.join(' ') || '-',
          role:      'PASSENGER',
          isVerified: false,
        },
      });
    }

    const reference  = `TPX${Date.now().toString(36).toUpperCase()}`;
    const totalAmount = trip.price * dto.seatNumbers.length;
    const expiresAt   = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    const booking = await this.prisma.booking.create({
      data: {
        reference,
        tenantId:    trip.tenantId,
        tripId:      trip.id,
        passengerId: passenger.id,
        seatNumbers: dto.seatNumbers,
        totalAmount,
        currency:    'XOF',
        expiresAt,
        status:      'PENDING',
      },
      select: {
        id: true, reference: true, status: true,
        totalAmount: true, currency: true, expiresAt: true, createdAt: true,
        trip: {
          select: {
            departureAt: true, estimatedArrivalAt: true,
            route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
          },
        },
      },
    });

    return booking;
  }

  async getBookingByReference(reference: string, tenantId?: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true, reference: true, status: true,
        totalAmount: true, currency: true, expiresAt: true, confirmedAt: true, createdAt: true,
        seatNumbers: true,
        trip: {
          select: {
            departureAt: true, estimatedArrivalAt: true, status: true,
            route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
            tenant: { select: { name: true, phone: true } },
          },
        },
        passenger: { select: { firstName: true, lastName: true, phone: true } },
        payment:   { select: { status: true, method: true, paidAt: true } },
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    return booking;
  }

  // ── Colis ──────────────────────────────────────────────────────────────────

  async trackParcel(code: string) {
    const parcel = await this.prisma.parcel.findUnique({
      where:  { trackingCode: code },
      select: {
        trackingCode: true, description: true, weightKg: true,
        status: true, declaredValue: true, createdAt: true,
        senderName: true, recipientName: true, recipientPhone: true,
        station: { select: { name: true, city: { select: { name: true } } } },
        trip: {
          select: {
            departureAt: true, estimatedArrivalAt: true, status: true,
            route: {
              select: {
                originCity:      { select: { name: true } },
                destinationCity: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!parcel) throw new NotFoundException('Colis introuvable');
    return parcel;
  }
}
