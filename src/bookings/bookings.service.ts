import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { SmsRouterService } from '../sms/sms-router.service';
import { WebhookEvent } from '@prisma/client';
import { CreateBookingDto, CreateGuichetBookingDto } from './dto/booking.dto';
import { SocketEvent, BOOKING_EXPIRY_MINUTES, COMMISSION_RATE, NotificationType, PaymentMethod } from '@transpro/shared';
import { generateReference } from '@transpro/shared';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import dayjs from 'dayjs';

@Injectable()
export class BookingsService {
  private readonly encryptionKey: string;

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private notifications: NotificationsService,
    private config: ConfigService,
    private webhooks: WebhooksService,
    private sms: SmsRouterService,
  ) {
    const key = this.config.get<string>('ENCRYPTION_KEY');
    if (!key) throw new Error('[BookingsService] ENCRYPTION_KEY manquante — démarrage refusé');
    this.encryptionKey = key;
  }

  private effectiveASM(trip: { advancedSeatManagement: boolean | null }, vehicle: { advancedSeatManagement: boolean }): boolean {
    return trip.advancedSeatManagement ?? vehicle.advancedSeatManagement;
  }

  async create(passengerId: string, dto: CreateBookingDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      select: {
        id: true, tenantId: true, status: true, price: true, availableSeats: true,
        advancedSeatManagement: true,
        vehicle: { select: { advancedSeatManagement: true } },
        route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
        tenant: { select: { name: true, logo: true } },
      },
    });

    if (!trip) throw new NotFoundException('Voyage introuvable');
    if (!['SCHEDULED', 'BOARDING'].includes(trip.status)) {
      throw new BadRequestException('Ce voyage n\'accepte plus de réservations');
    }

    const useAdvanced = this.effectiveASM(trip, trip.vehicle);

    if (useAdvanced && !dto.seatNumbers?.length) {
      throw new BadRequestException('Veuillez sélectionner au moins un siège');
    }

    const requestedCount = useAdvanced
      ? dto.seatNumbers!.length
      : (dto.passengerCount ?? dto.seatNumbers?.length ?? 1);

    if (trip.availableSeats < requestedCount) {
      throw new BadRequestException('Pas assez de places disponibles');
    }

    const lockExpiry = new Date(Date.now() + BOOKING_EXPIRY_MINUTES * 60 * 1000);
    const totalAmount = trip.price * requestedCount;

    // ── Transaction atomique ─────────────────────────────────────────────────
    // La sélection ET le verrouillage des sièges se font dans la même
    // transaction avec une condition sur status='AVAILABLE', ce qui empêche
    // toute surévente en cas de requêtes concurrentes.
    const booking = await this.prisma.$transaction(async (tx) => {
      const { seatNumbers, seatIds } = await this.reserveSeats(
        tx, dto.tripId,
        useAdvanced ? dto.seatNumbers! : null,
        requestedCount, lockExpiry, passengerId,
      );

      await tx.trip.update({
        where: { id: dto.tripId },
        data: { availableSeats: { decrement: requestedCount } },
      });

      return tx.booking.create({
        data: {
          reference: generateReference('TP'),
          tenantId: trip.tenantId,
          tripId: dto.tripId,
          passengerId,
          seatNumbers,
          status: 'PENDING',
          totalAmount,
          currency: 'XOF',
          expiresAt: lockExpiry,
          seats: { connect: seatIds.map((id) => ({ id })) },
        },
        include: {
          trip: {
            include: {
              route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
              vehicle: { select: { brand: true, model: true } },
              tenant: { select: { name: true, logo: true } },
            },
          },
        },
      });
    });

    for (const seatNumber of booking.seatNumbers) {
      this.realtime.broadcastToTrip(dto.tripId, SocketEvent.SEAT_UPDATED, {
        tripId: dto.tripId,
        seatNumber,
        status: 'RESERVED',
      });
    }

    this.notifications.create({
      userId: passengerId,
      type: NotificationType.BOOKING_CONFIRMED,
      templateData: {
        origin: (booking.trip.route as any).originCity?.name ?? '',
        destination: (booking.trip.route as any).destinationCity?.name ?? '',
      },
      data: { bookingId: booking.id },
      companyLogo: (booking.trip.tenant as any)?.logo ?? undefined,
    }).catch(() => {});

    return booking;
  }

  // ── Helpers privés : verrouillage atomique des sièges ────────────────────

  /**
   * Sélectionne et verrouille des sièges dans une transaction Prisma.
   * Si `explicitSeatNumbers` est fourni (mode avancé), ces sièges sont ciblés.
   * Sinon (auto-assign), les N premiers disponibles sont choisis dans la TX.
   * Lève ConflictException si les sièges sont pris entre-temps.
   */
  private async reserveSeats(
    tx: any,
    tripId: string,
    explicitSeatNumbers: string[] | null,
    count: number,
    lockExpiry: Date,
    lockedBy: string,
  ): Promise<{ seatNumbers: string[]; seatIds: string[] }> {
    const now = new Date();
    let seatIds: string[];
    let seatNumbers: string[];

    if (explicitSeatNumbers) {
      const found = await tx.tripSeat.findMany({
        where: { tripId, seatNumber: { in: explicitSeatNumbers } },
        select: { id: true, seatNumber: true },
      });
      seatIds    = found.map((s: any) => s.id);
      seatNumbers = explicitSeatNumbers;
    } else {
      const available = await tx.tripSeat.findMany({
        where: { tripId, status: 'AVAILABLE', OR: [{ lockedAt: null }, { lockedAt: { lte: now } }] },
        orderBy: { seatNumber: 'asc' },
        take: count,
        select: { id: true, seatNumber: true },
      });
      if (available.length < count) throw new BadRequestException('Pas assez de places disponibles');
      seatIds    = available.map((s: any) => s.id);
      seatNumbers = available.map((s: any) => s.seatNumber);
    }

    // Verrou atomique : n'affecte que les sièges encore AVAILABLE
    const lockResult = await tx.tripSeat.updateMany({
      where: { id: { in: seatIds }, status: 'AVAILABLE', OR: [{ lockedAt: null }, { lockedAt: { lte: now } }] },
      data: { status: 'RESERVED', lockedAt: lockExpiry, lockedBy },
    });

    if (lockResult.count !== count) {
      throw new ConflictException(
        `${count - lockResult.count} siège(s) ne sont plus disponibles — veuillez actualiser et réessayer`,
      );
    }

    return { seatNumbers, seatIds };
  }

  /** Retourne (ou crée une seule fois) le compte passager générique partagé d'un tenant. */
  private async getOrCreateGuestPassenger(tenant: { id: string; slug: string }): Promise<any> {
    const guestEmail = `guichet@${tenant.slug}.${this.config.get('APP_DOMAIN', 'transpro.ci')}`;
    const guestPhone = `+000${tenant.id.replace(/-/g, '').slice(0, 12)}`;

    return this.prisma.user.upsert({
      where:  { email: guestEmail },
      update: {},
      create: {
        email:        guestEmail,
        phone:        guestPhone,
        firstName:    'Client',
        lastName:     'Guichet',
        passwordHash: crypto.randomBytes(32).toString('hex'),
        role:         'PASSENGER',
        isVerified:   true,
      },
    });
  }

  /** Occupe des sièges directement (vente guichet → OCCUPIED sans lock intermédiaire). */
  private async occupySeats(
    tx: any,
    tripId: string,
    explicitSeatNumbers: string[] | null,
    count: number,
  ): Promise<{ seatNumbers: string[]; seatIds: string[] }> {
    let seatIds: string[];
    let seatNumbers: string[];

    if (explicitSeatNumbers) {
      const found = await tx.tripSeat.findMany({
        where: { tripId, seatNumber: { in: explicitSeatNumbers } },
        select: { id: true, seatNumber: true },
      });
      seatIds    = found.map((s: any) => s.id);
      seatNumbers = explicitSeatNumbers;
    } else {
      const available = await tx.tripSeat.findMany({
        where: { tripId, status: 'AVAILABLE' },
        orderBy: { seatNumber: 'asc' },
        take: count,
        select: { id: true, seatNumber: true },
      });
      if (available.length < count) throw new BadRequestException('Pas assez de places disponibles');
      seatIds    = available.map((s: any) => s.id);
      seatNumbers = available.map((s: any) => s.seatNumber);
    }

    const lockResult = await tx.tripSeat.updateMany({
      where: { id: { in: seatIds }, status: 'AVAILABLE' },
      data: { status: 'OCCUPIED', lockedAt: null, lockedBy: null },
    });

    if (lockResult.count !== count) {
      throw new ConflictException(
        `${count - lockResult.count} siège(s) ne sont plus disponibles`,
      );
    }

    return { seatNumbers, seatIds };
  }

  /**
   * Libère des sièges et incrémente availableSeats dans une transaction.
   * Utilisé à l'annulation et à l'expiration.
   */
  private async releaseSeats(
    tx: any,
    tripId: string,
    seatNumbers: string[],
  ): Promise<void> {
    await tx.tripSeat.updateMany({
      where: { tripId, seatNumber: { in: seatNumbers } },
      data: { status: 'AVAILABLE', bookingId: null, lockedAt: null, lockedBy: null },
    });
    await tx.trip.update({
      where: { id: tripId },
      data: { availableSeats: { increment: seatNumbers.length } },
    });
  }

  async findByPassenger(passengerId: string) {
    return this.prisma.booking.findMany({
      where: { passengerId },
      include: {
        trip: {
          include: {
            route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
            tenant: { select: { name: true, logo: true } },
          },
        },
        tickets: true,
        payment: { select: { method: true, status: true, paidAt: true } },
        rating: { select: { rating: true, comment: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByTenant(tenantId: string, filters: { status?: string; tripId?: string }) {
    return this.prisma.booking.findMany({
      where: {
        tenantId,
        ...(filters.status && { status: filters.status as any }),
        ...(filters.tripId && { tripId: filters.tripId }),
      },
      include: {
        passenger: { select: { firstName: true, lastName: true, phone: true, email: true } },
        trip: {
          include: { route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } },
        },
        tickets: true,
        payment: { select: { method: true, status: true, amount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(bookingId: string, tenantId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
      include: {
        passenger: { select: { firstName: true, lastName: true, phone: true, email: true } },
        trip: {
          include: {
            route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
            tenant: { select: { name: true, logo: true } },
          },
        },
        tickets: { orderBy: { seatNumber: 'asc' } },
        payment: { select: { method: true, status: true, paidAt: true } },
      },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    return booking;
  }

  async findOneForPassenger(bookingId: string, passengerId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, passengerId },
      include: {
        trip: {
          include: {
            route: {
                select: {
                  name: true,
                  durationMinutes: true,
                  originCity: { select: { name: true } },
                  destinationCity: { select: { name: true } },
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
            tenant: { select: { name: true, logo: true, slug: true } },
            vehicle: { select: { plate: true, brand: true, model: true } },
            departureStation: { select: { id: true, name: true, address: true, latitude: true, longitude: true, city: { select: { name: true } } } },
            arrivalStation:   { select: { id: true, name: true, address: true, latitude: true, longitude: true, city: { select: { name: true } } } },
          },
        },
        tickets: { orderBy: { seatNumber: 'asc' } },
        payment: { select: { method: true, status: true, paidAt: true } },
        rating: { select: { rating: true, comment: true, createdAt: true } },
      },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    return booking;
  }

  /**
   * Récupération publique d'un billet par sa référence (vente guichet, lien SMS).
   * Aucune auth : la référence aléatoire fait office de jeton. Forme réduite —
   * pas de PII passager ni de détails de paiement, uniquement de quoi afficher
   * et présenter le(s) QR à l'embarquement.
   */
  async findPublicByReference(reference: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { reference: reference.trim() },
      include: {
        trip: {
          include: {
            route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
            tenant: { select: { name: true, logo: true } },
            departureStation: { select: { name: true } },
          },
        },
        tickets: { orderBy: { seatNumber: 'asc' }, select: { seatNumber: true, qrCode: true, qrCodeData: true } },
      },
    });
    if (!booking) throw new NotFoundException('Billet introuvable. Vérifiez la référence.');

    const t: any = booking.trip;
    return {
      reference:    booking.reference,
      status:       booking.status,
      seatNumbers:  booking.seatNumbers,
      totalAmount:  booking.totalAmount,
      currency:     booking.currency,
      trip: {
        originCity:      t?.route?.originCity?.name ?? null,
        destinationCity: t?.route?.destinationCity?.name ?? null,
        departureAt:     t?.departureAt ?? null,
        tripClass:       t?.tripClass ?? null,
        departureStation: t?.departureStation?.name ?? null,
        companyName:     t?.tenant?.name ?? null,
        companyLogo:     t?.tenant?.logo ?? null,
      },
      tickets: booking.tickets,
    };
  }

  /** Lien public de récupération du billet (page web universelle). */
  private ticketLink(reference: string): string {
    const base = (this.config.get<string>('FRONTEND_URL') || this.config.get<string>('APP_URL') || '').replace(/\/$/, '');
    return base ? `${base}/ticket/${reference}` : '';
  }

  /** Envoie (ou renvoie) au passager un SMS de récupération de billet. */
  private async sendTicketSms(phone: string, booking: any): Promise<void> {
    const ref    = booking.reference as string;
    const link   = this.ticketLink(ref);
    const origin = booking?.trip?.route?.originCity?.name ?? '';
    const dest   = booking?.trip?.route?.destinationCity?.name ?? '';
    const dep    = booking?.trip?.departureAt ? dayjs(booking.trip.departureAt).format('DD/MM HH:mm') : '';
    const trajet = origin && dest ? `${origin}-${dest} ` : '';
    const depTxt = dep ? `, depart ${dep}` : '';
    const message = link
      ? `{APP}: billet confirme ${trajet}ref ${ref}${depTxt}. Votre billet: ${link}`
      : `{APP}: billet confirme ${trajet}ref ${ref}${depTxt}. Presentez la reference ${ref} a l'embarquement.`;
    await this.sms.send(phone, message);
  }

  /** Renvoi du SMS de billet par un agent/owner (ex. client sans app, numéro saisi après-coup). */
  async resendTicketSms(bookingId: string, tenantId: string, phone: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
      include: {
        trip: { include: { route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } } },
      },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    await this.sendTicketSms(phone, booking);
    return { sent: true, reference: booking.reference };
  }

  async rateBooking(bookingId: string, passengerId: string, dto: { rating: number; comment?: string }) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, passengerId, status: 'COMPLETED' },
      select: { id: true },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable ou non terminée');
    return this.prisma.tripRating.upsert({
      where: { bookingId },
      create: { bookingId, passengerId, rating: dto.rating, comment: dto.comment },
      update: { rating: dto.rating, comment: dto.comment },
    });
  }

  async cancel(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true, trip: { select: { tenant: { select: { logo: true } } } } },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.passengerId !== userId) throw new BadRequestException('Accès refusé');
    if (['CANCELLED', 'COMPLETED'].includes(booking.status)) {
      throw new BadRequestException('Cette réservation ne peut pas être annulée');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await this.releaseSeats(tx, booking.tripId, booking.seatNumbers);
    });

    // Libérer les sièges en temps réel
    for (const seatNumber of booking.seatNumbers) {
      this.realtime.broadcastToTrip(booking.tripId, SocketEvent.SEAT_UPDATED, {
        tripId: booking.tripId,
        seatNumber,
        status: 'AVAILABLE',
      });
    }

    this.realtime.broadcastToCompany(booking.tenantId, SocketEvent.BOOKING_CANCELLED, {
      bookingId,
    });

    this.notifications.create({
      userId: booking.passengerId,
      type: NotificationType.BOOKING_CANCELLED,
      templateData: {},
      data: { bookingId },
      companyLogo: (booking.trip as any)?.tenant?.logo ?? undefined,
    }).catch(() => {});

    return { message: 'Réservation annulée avec succès' };
  }

  async createGuichet(tenantId: string, agentId: string, dto: CreateGuichetBookingDto) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: dto.tripId, tenantId },
      include: {
        route: true,
        tenant: true,
        seats: true,
        vehicle: { select: { advancedSeatManagement: true } },
      },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable');
    if (!['SCHEDULED', 'BOARDING'].includes(trip.status)) {
      throw new BadRequestException('Ce voyage n\'accepte plus de ventes');
    }

    const useAdvanced = this.effectiveASM(trip, trip.vehicle);

    if (useAdvanced && !dto.seatNumbers?.length) {
      throw new BadRequestException('Veuillez sélectionner au moins un siège');
    }

    const requestedCountGuichet = useAdvanced
      ? dto.seatNumbers!.length
      : (dto.passengerCount ?? dto.seatNumbers?.length ?? 1);

    if (trip.availableSeats < requestedCountGuichet) {
      throw new BadRequestException('Pas assez de places disponibles');
    }

    // Trouver ou créer le passager
    let passenger = dto.phone
      ? await this.prisma.user.findFirst({ where: { phone: dto.phone } })
      : null;

    if (!passenger) {
      if (dto.phone) {
        // Téléphone fourni mais inconnu → compte lié à ce numéro
        const strongPwd    = crypto.randomBytes(32).toString('hex');
        const passwordHash = await bcrypt.hash(strongPwd, 12);
        const email        = `${dto.phone.replace(/\D/g, '')}@guichet.${this.config.get('APP_DOMAIN', 'transpro.ci')}`;
        passenger = await this.prisma.user.upsert({
          where:  { email },
          update: {},
          create: {
            email,
            phone: dto.phone,
            firstName:    dto.firstName ?? 'Client',
            lastName:     dto.lastName  ?? 'Anonyme',
            passwordHash,
            role:         'PASSENGER',
            isVerified:   true,
          },
        });
      } else {
        // Pas de téléphone → compte générique partagé de la compagnie (1 seul par tenant)
        passenger = await this.getOrCreateGuestPassenger(trip.tenant as any);
      }
    }

    const bookingRef     = generateReference('TP');
    const totalAmount    = trip.price * requestedCountGuichet;
    const paymentMethod  = dto.paymentMethod ?? PaymentMethod.CASH;

    // Les tickets sont générés avant la transaction (QR encoding = CPU-bound)
    // On connaît déjà les seatNumbers voulus mais pas encore le bookingId :
    // on pré-signe avec un placeholder et complète dans la TX.
    // Pour simplifier : on génère les tickets APRÈS avoir récupéré les seatNumbers
    // depuis la transaction via une 2ème passe (voir ci-dessous).

    const booking = await this.prisma.$transaction(async (tx) => {
      // ── Verrou atomique des sièges (guichet → OCCUPIED directement) ─────
      const { seatNumbers, seatIds } = await this.occupySeats(
        tx, dto.tripId,
        useAdvanced ? dto.seatNumbers! : null,
        requestedCountGuichet,
      );

      await tx.trip.update({
        where: { id: dto.tripId },
        data: { availableSeats: { decrement: requestedCountGuichet } },
      });

      // Génération des QR codes (dans la TX pour cohérence)
      const ticketsData = await Promise.all(
        seatNumbers.map(async (seatNumber) => {
          const ticketData = {
            bookingRef,
            tripId: dto.tripId,
            seatNumber,
            passengerId: passenger!.id,
            issuedAt: new Date().toISOString(),
          };
          const sig = this.signTicket(ticketData);
          const qrData = JSON.stringify({ ...ticketData, sig });
          const qrCode = await QRCode.toDataURL(qrData);
          return { seatNumber, qrCode, qrCodeData: qrData };
        }),
      );

      const b = await tx.booking.create({
        data: {
          reference: bookingRef,
          tenantId,
          tripId: dto.tripId,
          passengerId: passenger!.id,
          seatNumbers,
          status: 'CONFIRMED',
          totalAmount,
          currency: 'XOF',
          expiresAt: dayjs().add(1, 'year').toDate(),
          confirmedAt: new Date(),
          ...(dto.stationId && { soldByStationId: dto.stationId }),
          seats: { connect: seatIds.map((id) => ({ id })) },
        },
      });

      const commissionAmount = Math.round(totalAmount * COMMISSION_RATE);
      await tx.payment.create({
        data: {
          bookingId: b.id,
          tenantId,
          amount: totalAmount,
          currency: 'XOF',
          method: paymentMethod,
          status: 'SUCCESS',
          transactionId: generateReference('CASH'),
          commissionAmount,
          netAmount: totalAmount - commissionAmount,
          paidAt: new Date(),
          phoneNumber: dto.phone,
        },
      });

      await tx.ticket.createMany({
        data: ticketsData.map((t) => ({
          bookingId: b.id,
          seatNumber: t.seatNumber,
          qrCode: t.qrCode,
          qrCodeData: t.qrCodeData,
        })),
      });

      return b;
    });

    for (const seatNumber of booking.seatNumbers) {
      this.realtime.broadcastToTrip(dto.tripId, SocketEvent.SEAT_UPDATED, {
        tripId: dto.tripId,
        seatNumber,
        status: 'OCCUPIED',
      });
    }
    this.realtime.broadcastToCompany(tenantId, SocketEvent.BOOKING_CREATED, {
      bookingId: booking.id,
      tripId: dto.tripId,
    });

    this.notifications.create({
      userId: passenger!.id,
      type: NotificationType.TICKET_READY,
      templateData: {},
      data: { bookingId: booking.id },
      companyLogo: (trip.tenant as any)?.logo ?? undefined,
    }).catch(() => {});

    const full = await this.prisma.booking.findUnique({
      where: { id: booking.id },
      include: {
        passenger: { select: { firstName: true, lastName: true, phone: true, email: true } },
        trip: {
          include: {
            route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
            tenant: { select: { name: true, logo: true } },
          },
        },
        tickets: { orderBy: { seatNumber: 'asc' } },
        payment: { select: { method: true, status: true, paidAt: true } },
      },
    });

    // SMS de récupération (lien web universel) si un numéro a été fourni.
    // Fire-and-forget : ne jamais bloquer/échouer la vente sur un souci SMS.
    if (dto.phone) {
      this.sendTicketSms(dto.phone, full).catch(() => {});
    }

    return full;
  }

  async updateStatus(bookingId: string, tenantId: string, status: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
      select: {
        id: true, status: true, tripId: true, tenantId: true,
        passengerId: true, seatNumbers: true, reference: true,
        _count: { select: { tickets: true } },
      },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');

    const allowed: Record<string, string[]> = {
      PENDING:   ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['COMPLETED', 'NO_SHOW', 'CANCELLED'],
      COMPLETED: [],
      NO_SHOW:   [],
      CANCELLED: [],
    };
    if (!allowed[booking.status]?.includes(status)) {
      throw new BadRequestException(`Transition ${booking.status} → ${status} non autorisée`);
    }

    await this.prisma.$transaction(async (tx) => {
      const data: any = { status };

      if (status === 'CONFIRMED') {
        data.confirmedAt = new Date();
        await tx.tripSeat.updateMany({
          where: { tripId: booking.tripId, seatNumber: { in: booking.seatNumbers } },
          data: { status: 'OCCUPIED', lockedAt: null, lockedBy: null },
        });

        if (booking._count.tickets === 0) {
          const ticketsData = await Promise.all(
            booking.seatNumbers.map(async (seatNumber) => {
              const ticketData = {
                bookingRef: booking.reference,
                tripId:     booking.tripId,
                seatNumber,
                passengerId: booking.passengerId,
                issuedAt:   new Date().toISOString(),
              };
              const sig     = this.signTicket(ticketData);
              const qrData  = JSON.stringify({ ...ticketData, sig });
              const qrCode  = await QRCode.toDataURL(qrData);
              return { seatNumber, qrCode, qrCodeData: qrData };
            }),
          );
          await tx.ticket.createMany({
            data: ticketsData.map((t) => ({
              bookingId,
              seatNumber:  t.seatNumber,
              qrCode:      t.qrCode,
              qrCodeData:  t.qrCodeData,
            })),
          });
        }
      }

      if (status === 'CANCELLED') {
        data.cancelledAt = new Date();
        data.cancelReason = 'Annulation manuelle par l\'administration';
        await this.releaseSeats(tx, booking.tripId, booking.seatNumbers);
      }

      await tx.booking.update({ where: { id: bookingId }, data });
    });

    if (status === 'CANCELLED') {
      for (const seatNumber of booking.seatNumbers) {
        this.realtime.broadcastToTrip(booking.tripId, SocketEvent.SEAT_UPDATED, {
          tripId: booking.tripId, seatNumber, status: 'AVAILABLE',
        });
      }
      this.realtime.broadcastToCompany(booking.tenantId, SocketEvent.BOOKING_CANCELLED, { bookingId });
    } else if (status === 'CONFIRMED') {
      for (const seatNumber of booking.seatNumbers) {
        this.realtime.broadcastToTrip(booking.tripId, SocketEvent.SEAT_UPDATED, {
          tripId: booking.tripId, seatNumber, status: 'OCCUPIED',
        });
      }
    }

    return this.findOne(bookingId, tenantId);
  }

  async generateMissingTickets(bookingId: string, tenantId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId, status: 'CONFIRMED' },
      select: {
        id: true, reference: true, tripId: true, passengerId: true, seatNumbers: true,
        _count: { select: { tickets: true } },
      },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable ou non confirmée');
    if (booking._count.tickets > 0) return { generated: 0, message: 'Les tickets existent déjà' };

    const ticketsData = await Promise.all(
      booking.seatNumbers.map(async (seatNumber) => {
        const ticketData = {
          bookingRef:  booking.reference,
          tripId:      booking.tripId,
          seatNumber,
          passengerId: booking.passengerId,
          issuedAt:    new Date().toISOString(),
        };
        const sig    = this.signTicket(ticketData);
        const qrData = JSON.stringify({ ...ticketData, sig });
        const qrCode = await QRCode.toDataURL(qrData);
        return { seatNumber, qrCode, qrCodeData: qrData };
      }),
    );

    await this.prisma.ticket.createMany({
      data: ticketsData.map((t) => ({
        bookingId,
        seatNumber: t.seatNumber,
        qrCode:     t.qrCode,
        qrCodeData: t.qrCodeData,
      })),
    });

    return { generated: ticketsData.length };
  }

  private signTicket(data: object): string {
    return crypto
      .createHmac('sha256', this.encryptionKey)
      .update(JSON.stringify(data))
      .digest('hex');
  }

  // Expire les réservations non payées — traitement par batch de 200
  @Cron(CronExpression.EVERY_MINUTE)
  async expireUnpaidBookings() {
    const BATCH = 200;
    const now   = new Date();
    let processed = 0;

    while (true) {
      const expired = await this.prisma.booking.findMany({
        where: { status: 'PENDING', expiresAt: { lt: now } },
        select: {
          id: true, reference: true, tripId: true, passengerId: true, seatNumbers: true,
          tenantId: true, apiConsumerId: true,
          trip: { select: { tenant: { select: { logo: true } } } },
        },
        take: BATCH,
      });

      if (expired.length === 0) break;

      // Annulation et libération en transactions parallèles (max 20 simultanées)
      await Promise.all(
        expired.map((booking) =>
          this.prisma.$transaction(async (tx) => {
            await tx.booking.update({
              where: { id: booking.id },
              data: { status: 'CANCELLED', cancelReason: 'Expiration du délai de paiement' },
            });
            await this.releaseSeats(tx, booking.tripId, booking.seatNumbers);
          }),
        ),
      );

      // Notifications temps réel et push (non bloquant)
      for (const booking of expired) {
        for (const seatNumber of booking.seatNumbers) {
          this.realtime.broadcastToTrip(booking.tripId, SocketEvent.SEAT_UPDATED, {
            tripId: booking.tripId, seatNumber, status: 'AVAILABLE',
          });
        }
        this.notifications.create({
          userId: booking.passengerId,
          type: NotificationType.BOOKING_EXPIRED,
          templateData: {},
          data: { bookingId: booking.id },
          companyLogo: (booking as any).trip?.tenant?.logo ?? undefined,
        }).catch(() => {});

        // Webhook API tierce : la réservation créée via /ext a expiré.
        if (booking.apiConsumerId) {
          this.webhooks.emitToConsumer(booking.apiConsumerId, WebhookEvent.BOOKING_CANCELLED, {
            bookingId: booking.id, reference: booking.reference, status: 'CANCELLED',
            tripId: booking.tripId, reason: 'Expiration du délai de paiement',
          }).catch(() => {});
        }
      }

      processed += expired.length;
      if (expired.length < BATCH) break;
    }

    if (processed > 0) {
      // Logger importé via NestJS Logger si besoin — log minimal ici
      console.log(`[expireUnpaidBookings] ${processed} réservation(s) expirée(s)`);
    }
  }
}
