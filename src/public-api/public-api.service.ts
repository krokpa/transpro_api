import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class PublicApiService {
  private readonly logger = new Logger(PublicApiService.name);

  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
  ) {}

  /**
   * Filtre tenant pour les endpoints publics.
   * - Consumer lié à une compagnie → accès à SA compagnie uniquement.
   * - Consumer cross-compagnie (tenantId null) → uniquement les compagnies
   *   ayant activé l'API publique (opt-in `publicApiEnabled`).
   */
  private tenantWhere(tenantId?: string) {
    return tenantId
      ? { tenantId }
      : { tenant: { publicApiEnabled: true } };
  }

  /** Normalise limit/offset : limit dans [1,100] (défaut 50), offset >= 0. */
  private paginate(limit?: number, offset?: number) {
    const take = Math.min(100, Math.max(1, limit ?? 50));
    const skip = Math.max(0, offset ?? 0);
    return { take, skip };
  }

  // ── Voyages ────────────────────────────────────────────────────────────────

  async searchTrips(params: {
    origin:        string;
    destination:   string;
    departureDate: string;
    passengers?:   number;
    tenantId?:     string;
    limit?:        number;
    offset?:       number;
  }) {
    const date   = new Date(params.departureDate);
    if (isNaN(date.getTime())) throw new BadRequestException('departureDate invalide (YYYY-MM-DD)');

    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    const { take, skip } = this.paginate(params.limit, params.offset);

    return this.prisma.trip.findMany({
      where: {
        status:      { in: ['SCHEDULED', 'BOARDING'] },
        departureAt: { gte: dayStart, lte: dayEnd },
        ...this.tenantWhere(params.tenantId),
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
      take,
      skip,
    });
  }

  async getTrip(id: string, tenantId?: string) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id,
        status: { in: ['SCHEDULED', 'BOARDING', 'DEPARTED'] },
        ...this.tenantWhere(tenantId),
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

  async listStations(tenantId?: string, limit?: number, offset?: number) {
    const { take, skip } = this.paginate(limit, offset);
    return this.prisma.station.findMany({
      take,
      skip,
      where: { isActive: true, ...this.tenantWhere(tenantId) },
      select: {
        id: true, name: true, code: true, address: true, latitude: true, longitude: true,
        city:   { select: { name: true, region: true } },
        tenant: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ tenant: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async listRoutes(tenantId?: string, limit?: number, offset?: number) {
    const { take, skip } = this.paginate(limit, offset);
    return this.prisma.route.findMany({
      take,
      skip,
      where: { isActive: true, ...this.tenantWhere(tenantId) },
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
    apiConsumerId?:  string;
  }) {
    // Charger le voyage
    const trip = await this.prisma.trip.findFirst({
      where: {
        id:     dto.tripId,
        status: { in: ['SCHEDULED', 'BOARDING'] },
        ...this.tenantWhere(dto.tenantId),
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
        apiConsumerId: dto.apiConsumerId,
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

    // Initie le paiement et renvoie le lien de checkout au tiers.
    // En cas d'échec (provider indisponible), la réservation reste PENDING et
    // expire ; le tiers peut relancer le paiement via /bookings/:ref/pay (à venir).
    let payment: { url: string | null; reference: string | null; expiresAt: Date } = {
      url: null,
      reference: null,
      expiresAt: booking.expiresAt!,
    };
    try {
      const res = await this.payments.initiate(booking.id, passenger.id);
      payment = { url: res.checkoutUrl, reference: res.reference, expiresAt: booking.expiresAt! };
    } catch (err) {
      this.logger.warn(
        `Paiement non initié pour la réservation API ${booking.reference}: ${(err as Error).message}`,
      );
    }

    return { ...booking, payment };
  }

  async getBookingByReference(reference: string, tenantId?: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, ...this.tenantWhere(tenantId) },
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

  async trackParcel(code: string, tenantId?: string) {
    const parcel = await this.prisma.parcel.findFirst({
      where:  { trackingCode: code, ...this.tenantWhere(tenantId) },
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
