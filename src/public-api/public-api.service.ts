import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { BookingsService } from '../bookings/bookings.service';
import { ParcelsService } from '../parcels/parcels.service';
import { WebhookEvent } from '@prisma/client';
import { calculateParcelFee, PARCEL_MAX_WEIGHT_KG } from '@transpro/shared';

@Injectable()
export class PublicApiService {
  private readonly logger = new Logger(PublicApiService.name);

  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
    private webhooks: WebhooksService,
    private bookings: BookingsService,
    private parcels: ParcelsService,
    private config: ConfigService,
  ) {}

  private get domain(): string {
    return this.config.get<string>('APP_DOMAIN', 'transpro.ci');
  }

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
    isTest?:         boolean;
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

    // ── Mode sandbox (clé TEST) : réponse simulée, aucune persistance ──
    // Valide les entrées mais ne crée pas de réservation et ne touche pas
    // aux places ; renvoie une réservation fictive + un lien de paiement factice.
    if (dto.isTest) {
      const ref = `TPX_TEST_${Date.now().toString(36).toUpperCase()}`;
      return {
        test: true,
        id: `test_${ref}`,
        reference: ref,
        status: 'PENDING',
        totalAmount: trip.price * dto.seatNumbers.length,
        currency: 'XOF',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        createdAt: new Date(),
        seatNumbers: dto.seatNumbers,
        payment: {
          url: `https://sandbox.${this.domain}/pay/${ref}`,
          reference: ref,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
        message:
          'Réponse sandbox — aucune réservation réelle créée. Utilisez POST /ext/test/trigger-webhook pour tester vos webhooks.',
      };
    }

    // Trouver ou créer le passager
    let passenger = await this.prisma.user.findUnique({ where: { phone: dto.passengerPhone } });
    if (!passenger) {
      const [firstName, ...lastParts] = dto.passengerName.trim().split(' ');
      passenger = await this.prisma.user.create({
        data: {
          phone:     dto.passengerPhone,
          email:     dto.passengerEmail ?? `ext_${dto.passengerPhone.replace(/\D/g, '')}@api.${this.domain}`,
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

    // Webhook : réservation initiée (paiement en attente).
    if (dto.apiConsumerId) {
      this.webhooks.emitToConsumer(dto.apiConsumerId, 'BOOKING_CREATED' as WebhookEvent, {
        reference:   booking.reference,
        status:      booking.status,
        tripId:      trip.id,
        totalAmount: booking.totalAmount,
        currency:    booking.currency,
        expiresAt:   booking.expiresAt,
      }).catch(() => {});
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

  // ── Sandbox ─────────────────────────────────────────────────────────────────

  /**
   * Émet un événement webhook d'exemple vers le consumer, pour qu'un développeur
   * teste son endpoint de réception. Réservé aux clés TEST.
   */
  async triggerTestWebhook(consumerId?: string, environment?: string, event?: string) {
    if (environment !== 'TEST') {
      throw new ForbiddenException('Réservé aux clés de test (tpk_test_).');
    }
    const consumer = await this.prisma.apiConsumer.findUnique({
      where: { id: consumerId ?? '' },
    });
    if (!consumer?.webhookUrl) {
      throw new BadRequestException(
        'Configurez d’abord une URL webhook sur votre intégration.',
      );
    }

    const allowed = Object.values(WebhookEvent) as string[];
    const evt = (event && allowed.includes(event) ? event : 'BOOKING_CONFIRMED') as WebhookEvent;

    await this.webhooks.emitToConsumer(consumer.id, evt, {
      test: true,
      bookingId: 'test_booking',
      reference: 'TPX_TEST_SAMPLE',
      status: 'CONFIRMED',
      tripId: 'test_trip',
      note: 'Événement de test généré depuis le sandbox TransPro.',
    });

    return { queued: true, event: evt, url: consumer.webhookUrl };
  }

  // ── Plan de salle ───────────────────────────────────────────────────────────

  async getTripSeats(tripId: string, tenantId?: string) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, ...this.tenantWhere(tenantId) },
      select: { id: true, totalSeats: true, availableSeats: true },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable');

    const seats = await this.prisma.tripSeat.findMany({
      where: { tripId },
      select: { seatNumber: true, status: true },
      orderBy: { seatNumber: 'asc' },
    });

    return {
      tripId:         trip.id,
      totalSeats:     trip.totalSeats,
      availableSeats: trip.availableSeats,
      seats: seats.map((s) => ({
        seatNumber: s.seatNumber,
        status:     s.status,
        available:  s.status === 'AVAILABLE',
      })),
    };
  }

  // ── Villes ──────────────────────────────────────────────────────────────────

  async listCities(limit?: number, offset?: number) {
    const { take, skip } = this.paginate(limit, offset);
    return this.prisma.city.findMany({
      where:   { isActive: true },
      select:  { id: true, name: true, region: true, code: true },
      orderBy: { name: 'asc' },
      take, skip,
    });
  }

  // ── Compagnies ──────────────────────────────────────────────────────────────

  async listCompanies(tenantId?: string, limit?: number, offset?: number) {
    const { take, skip } = this.paginate(limit, offset);
    return this.prisma.tenant.findMany({
      where: tenantId ? { id: tenantId } : { publicApiEnabled: true, status: 'ACTIVE' },
      select: {
        id: true, name: true, slug: true, logo: true, phone: true,
        city: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take, skip,
    });
  }

  // ── Plannings (départs récurrents) ──────────────────────────────────────────

  async listSchedules(tenantId?: string, limit?: number, offset?: number) {
    const { take, skip } = this.paginate(limit, offset);
    return this.prisma.schedule.findMany({
      where: { isActive: true, ...this.tenantWhere(tenantId) },
      select: {
        id: true, label: true, departureTime: true, daysOfWeek: true,
        price: true, tripClass: true, amenities: true,
        route: {
          select: {
            name: true, durationMinutes: true,
            originCity:      { select: { name: true } },
            destinationCity: { select: { name: true } },
          },
        },
        tenant: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ tenant: { name: 'asc' } }, { departureTime: 'asc' }],
      take, skip,
    });
  }

  // ── Avis & notes ────────────────────────────────────────────────────────────

  async listRatings(params: { tenantId?: string; company?: string; limit?: number; offset?: number }) {
    const { take, skip } = this.paginate(params.limit, params.offset);
    const bookingWhere: any = { ...this.tenantWhere(params.tenantId) };
    if (params.company) bookingWhere.tenant = { ...(bookingWhere.tenant ?? {}), slug: params.company };

    return this.prisma.tripRating.findMany({
      where: { booking: bookingWhere },
      select: {
        rating: true, comment: true, createdAt: true,
        booking: {
          select: {
            tenant: { select: { name: true, slug: true } },
            trip:   { select: { route: { select: { name: true } } } },
          },
        },
        passenger: { select: { firstName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });
  }

  // ── Mes réservations (créées via cette intégration) ─────────────────────────

  async listBookings(params: { apiConsumerId?: string; phone?: string; limit?: number; offset?: number }) {
    const { take, skip } = this.paginate(params.limit, params.offset);
    return this.prisma.booking.findMany({
      where: {
        apiConsumerId: params.apiConsumerId ?? '__none__',
        ...(params.phone ? { passenger: { phone: params.phone } } : {}),
      },
      select: {
        reference: true, status: true, totalAmount: true, currency: true,
        seatNumbers: true, createdAt: true, expiresAt: true, confirmedAt: true,
        trip: {
          select: {
            departureAt: true,
            route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
          },
        },
        passenger: { select: { firstName: true, lastName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });
  }

  // ── Billets (QR) ────────────────────────────────────────────────────────────

  async getBookingTickets(reference: string, tenantId?: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, ...this.tenantWhere(tenantId) },
      select: {
        reference: true, status: true,
        tickets: {
          select: { seatNumber: true, qrCode: true, qrCodeData: true, isScanned: true, scannedAt: true },
          orderBy: { seatNumber: 'asc' },
        },
      },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    return { reference: booking.reference, status: booking.status, tickets: booking.tickets };
  }

  // ── Annulation ──────────────────────────────────────────────────────────────

  async cancelBooking(reference: string, tenantId?: string, apiConsumerId?: string) {
    const booking = await this.prisma.booking.findFirst({
      where:  { reference, ...this.tenantWhere(tenantId) },
      select: { id: true, passengerId: true, apiConsumerId: true },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (!apiConsumerId || booking.apiConsumerId !== apiConsumerId) {
      throw new ForbiddenException('Vous ne pouvez annuler que les réservations créées via votre intégration.');
    }
    return this.bookings.cancel(booking.id, booking.passengerId);
  }

  // ── (Re)paiement d'une réservation en attente ───────────────────────────────

  async payBooking(reference: string, tenantId?: string) {
    const booking = await this.prisma.booking.findFirst({
      where:  { reference, ...this.tenantWhere(tenantId) },
      select: { id: true, passengerId: true, status: true, expiresAt: true, reference: true },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.status !== 'PENDING') {
      throw new BadRequestException('Seules les réservations en attente de paiement peuvent être (re)payées.');
    }
    const res = await this.payments.initiate(booking.id, booking.passengerId);
    return {
      reference: booking.reference,
      payment: { url: res.checkoutUrl, reference: res.reference, expiresAt: booking.expiresAt },
    };
  }

  // ── Colis : cotation & création ─────────────────────────────────────────────

  async quoteParcel(tripId: string, weightKg: number, tenantId?: string) {
    if (!weightKg || weightKg <= 0) throw new BadRequestException('weightKg requis (> 0)');
    if (weightKg > PARCEL_MAX_WEIGHT_KG) throw new BadRequestException(`Poids maximum : ${PARCEL_MAX_WEIGHT_KG} kg`);
    const trip = await this.prisma.trip.findFirst({
      where:  { id: tripId, ...this.tenantWhere(tenantId) },
      select: { route: { select: { distanceKm: true } } },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable');
    return {
      tripId, weightKg,
      fee:         calculateParcelFee(weightKg, trip.route.distanceKm),
      currency:    'XOF',
      maxWeightKg: PARCEL_MAX_WEIGHT_KG,
    };
  }

  async createParcel(dto: {
    tripId:         string;
    senderName:     string;
    senderPhone:    string;
    senderEmail?:   string;
    recipientName:  string;
    recipientPhone: string;
    recipientEmail?: string;
    deliveryCity:   string;
    description:    string;
    weightKg:       number;
    declaredValue?: number;
    fragile?:       boolean;
    tenantId?:      string;
    isTest?:        boolean;
  }) {
    const trip = await this.prisma.trip.findFirst({
      where:  { id: dto.tripId, status: { in: ['SCHEDULED', 'BOARDING'] }, ...this.tenantWhere(dto.tenantId) },
      select: { id: true, tenantId: true, route: { select: { distanceKm: true } } },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable ou n\'acceptant plus de colis');
    if (dto.weightKg > PARCEL_MAX_WEIGHT_KG) throw new BadRequestException(`Poids maximum : ${PARCEL_MAX_WEIGHT_KG} kg`);

    // Mode sandbox : réponse simulée, aucune persistance.
    if (dto.isTest) {
      return {
        test:         true,
        trackingCode: `TP-COL-TEST-${Date.now().toString(36).toUpperCase()}`,
        status:       'PENDING',
        fee:          calculateParcelFee(dto.weightKg, trip.route.distanceKm),
        currency:     'XOF',
        message:      'Réponse sandbox — aucun colis réel créé.',
      };
    }

    // Expéditeur = agent (trouvé ou créé par téléphone).
    let sender = await this.prisma.user.findUnique({ where: { phone: dto.senderPhone } });
    if (!sender) {
      const [firstName, ...lastParts] = dto.senderName.trim().split(' ');
      sender = await this.prisma.user.create({
        data: {
          phone:      dto.senderPhone,
          email:      dto.senderEmail ?? `ext_${dto.senderPhone.replace(/\D/g, '')}@api.${this.domain}`,
          firstName:  firstName ?? dto.senderName,
          lastName:   lastParts.join(' ') || '-',
          role:       'PASSENGER',
          isVerified: false,
        },
      });
    }

    const parcel = await this.parcels.create(
      trip.tenantId,
      sender.id,
      {
        tripId:         trip.id,
        recipientName:  dto.recipientName,
        recipientPhone: dto.recipientPhone,
        recipientEmail: dto.recipientEmail,
        deliveryCity:   dto.deliveryCity,
        description:    dto.description,
        weightKg:       dto.weightKg,
        declaredValue:  dto.declaredValue,
        fragile:        dto.fragile,
      } as any,
      {
        id:        sender.id,
        firstName: sender.firstName ?? dto.senderName,
        lastName:  sender.lastName ?? '',
        phone:     sender.phone ?? dto.senderPhone,
        email:     sender.email ?? '',
      },
    );

    // Webhook : colis enregistré (diffusé aux intégrations de la compagnie).
    this.webhooks.emitToTenantConsumers(trip.tenantId, 'PARCEL_REGISTERED' as WebhookEvent, {
      trackingCode: (parcel as any).trackingCode,
      status:       (parcel as any).status,
      tripId:       trip.id,
    }).catch(() => {});

    return parcel;
  }

  // ── Promotions / codes promo ────────────────────────────────────────────────

  async validatePromo(code: string, tenantId?: string) {
    const now = new Date();
    const promo = await this.prisma.promotion.findFirst({
      where: {
        code:     { equals: code, mode: 'insensitive' },
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
        OR: [{ tenantId: null }, ...(tenantId ? [{ tenantId }] : [])],
      },
      select: { code: true, type: true, title: true, subtitle: true, ctaUrl: true, color: true, endsAt: true, tenantId: true },
    });
    return promo ? { valid: true, ...promo } : { valid: false, code };
  }
}
