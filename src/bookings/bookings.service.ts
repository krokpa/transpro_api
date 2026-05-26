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
import { CreateBookingDto, CreateGuichetBookingDto } from './dto/booking.dto';
import { SocketEvent, BOOKING_EXPIRY_MINUTES, COMMISSION_RATE, NotificationType, PaymentMethod } from '@transpro/shared';
import { generateReference } from '@transpro/shared';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import dayjs from 'dayjs';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

  async create(passengerId: string, dto: CreateBookingDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      include: { seats: true },
    });

    if (!trip) throw new NotFoundException('Voyage introuvable');
    if (!['SCHEDULED', 'BOARDING'].includes(trip.status)) {
      throw new BadRequestException('Ce voyage n\'accepte plus de réservations');
    }
    if (trip.availableSeats < dto.seatNumbers.length) {
      throw new BadRequestException('Pas assez de places disponibles');
    }

    // Vérifier que les sièges sont disponibles (avec verrou optimiste)
    const requestedSeats = await this.prisma.tripSeat.findMany({
      where: {
        tripId: dto.tripId,
        seatNumber: { in: dto.seatNumbers },
      },
    });

    const unavailable = requestedSeats.filter(
      (s) => s.status !== 'AVAILABLE' || (s.lockedAt && s.lockedAt > new Date()),
    );

    if (unavailable.length > 0) {
      throw new ConflictException(
        `Sièges indisponibles: ${unavailable.map((s) => s.seatNumber).join(', ')}`,
      );
    }

    const lockExpiry = new Date(Date.now() + BOOKING_EXPIRY_MINUTES * 60 * 1000);
    const bookingExpiry = new Date(Date.now() + BOOKING_EXPIRY_MINUTES * 60 * 1000);
    const totalAmount = trip.price * dto.seatNumbers.length;

    // Transaction atomique: verrouiller sièges + créer réservation
    const booking = await this.prisma.$transaction(async (tx) => {
      // Verrouiller les sièges
      await tx.tripSeat.updateMany({
        where: { tripId: dto.tripId, seatNumber: { in: dto.seatNumbers } },
        data: {
          status: 'RESERVED',
          lockedAt: lockExpiry,
          lockedBy: passengerId,
        },
      });

      // Décrémenter les places disponibles
      await tx.trip.update({
        where: { id: dto.tripId },
        data: { availableSeats: { decrement: dto.seatNumbers.length } },
      });

      // Créer la réservation
      return tx.booking.create({
        data: {
          reference: generateReference('TP'),
          tenantId: trip.tenantId,
          tripId: dto.tripId,
          passengerId,
          seatNumbers: dto.seatNumbers,
          status: 'PENDING',
          totalAmount,
          currency: 'XOF',
          expiresAt: bookingExpiry,
          seats: {
            connect: requestedSeats.map((s) => ({ id: s.id })),
          },
        },
        include: {
          trip: {
            include: {
              route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
              vehicle: { select: { brand: true, model: true } },
              tenant: { select: { name: true } },
            },
          },
        },
      });
    });

    // Broadcast temps réel: sièges réservés
    for (const seatNumber of dto.seatNumbers) {
      this.realtime.broadcastToTrip(dto.tripId, SocketEvent.SEAT_UPDATED, {
        tripId: dto.tripId,
        seatNumber,
        status: 'RESERVED',
      });
    }

    this.notifications.create({
      userId: passengerId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Réservation créée',
      message: `Votre réservation ${(booking.trip.route as any).originCity?.name ?? ''} → ${(booking.trip.route as any).destinationCity?.name ?? ''} est en attente de paiement. Présentez-vous à la gare pour régler.`,
      data: { bookingId: booking.id },
    }).catch(() => {});

    return booking;
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
            route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
            tenant: { select: { name: true, logo: true } },
            vehicle: { select: { plate: true } },
          },
        },
        tickets: { orderBy: { seatNumber: 'asc' } },
        payment: { select: { method: true, status: true, paidAt: true } },
      },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    return booking;
  }

  async cancel(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
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

      await tx.tripSeat.updateMany({
        where: { tripId: booking.tripId, seatNumber: { in: booking.seatNumbers } },
        data: { status: 'AVAILABLE', bookingId: null, lockedAt: null, lockedBy: null },
      });

      await tx.trip.update({
        where: { id: booking.tripId },
        data: { availableSeats: { increment: booking.seatNumbers.length } },
      });
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
      title: 'Réservation annulée',
      message: `Votre réservation a été annulée. Les sièges ont été libérés.`,
      data: { bookingId },
    }).catch(() => {});

    return { message: 'Réservation annulée avec succès' };
  }

  async createGuichet(tenantId: string, agentId: string, dto: CreateGuichetBookingDto) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: dto.tripId, tenantId },
      include: { route: true, tenant: true },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable');
    if (!['SCHEDULED', 'BOARDING'].includes(trip.status)) {
      throw new BadRequestException('Ce voyage n\'accepte plus de ventes');
    }
    if (trip.availableSeats < dto.seatNumbers.length) {
      throw new BadRequestException('Pas assez de places disponibles');
    }

    const requestedSeats = await this.prisma.tripSeat.findMany({
      where: { tripId: dto.tripId, seatNumber: { in: dto.seatNumbers } },
    });
    const unavailable = requestedSeats.filter((s) => s.status !== 'AVAILABLE');
    if (unavailable.length > 0) {
      throw new ConflictException(
        `Sièges indisponibles: ${unavailable.map((s) => s.seatNumber).join(', ')}`,
      );
    }

    // Trouver ou créer le passager
    let passenger = dto.phone
      ? await this.prisma.user.findFirst({ where: { phone: dto.phone } })
      : null;

    if (!passenger) {
      const passwordHash = await bcrypt.hash(generateReference('PWD'), 10);
      const phone = dto.phone ?? `+000${generateReference('').replace(/-/g, '')}`;
      const email = dto.email ?? `${phone.replace(/\D/g, '')}_${Date.now()}@guichet.transpro.ci`;
      passenger = await this.prisma.user.create({
        data: {
          email,
          phone,
          firstName: dto.firstName ?? 'Client',
          lastName: dto.lastName ?? 'Anonyme',
          passwordHash,
          role: 'PASSENGER',
          isVerified: true,
        },
      });
    }

    const bookingRef = generateReference('TP');
    const totalAmount = trip.price * dto.seatNumbers.length;
    const paymentMethod = dto.paymentMethod ?? PaymentMethod.CASH;

    // Générer les QR codes
    const ticketsData = await Promise.all(
      dto.seatNumbers.map(async (seatNumber) => {
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

    const booking = await this.prisma.$transaction(async (tx) => {
      await tx.tripSeat.updateMany({
        where: { tripId: dto.tripId, seatNumber: { in: dto.seatNumbers } },
        data: { status: 'OCCUPIED', lockedAt: null, lockedBy: null },
      });
      await tx.trip.update({
        where: { id: dto.tripId },
        data: { availableSeats: { decrement: dto.seatNumbers.length } },
      });

      const b = await tx.booking.create({
        data: {
          reference: bookingRef,
          tenantId,
          tripId: dto.tripId,
          passengerId: passenger!.id,
          seatNumbers: dto.seatNumbers,
          status: 'CONFIRMED',
          totalAmount,
          currency: 'XOF',
          expiresAt: dayjs().add(1, 'year').toDate(),
          confirmedAt: new Date(),
          ...(dto.stationId && { soldByStationId: dto.stationId }),
          seats: { connect: requestedSeats.map((s) => ({ id: s.id })) },
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

    for (const seatNumber of dto.seatNumbers) {
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

    return this.prisma.booking.findUnique({
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
  }

  private signTicket(data: object): string {
    return crypto
      .createHmac('sha256', this.config.get('ENCRYPTION_KEY', 'default-key'))
      .update(JSON.stringify(data))
      .digest('hex');
  }

  // Expire les réservations non payées toutes les minutes
  @Cron(CronExpression.EVERY_MINUTE)
  async expireUnpaidBookings() {
    const expired = await this.prisma.booking.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
    });

    for (const booking of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: 'CANCELLED', cancelReason: 'Expiration du délai de paiement' },
        });

        await tx.tripSeat.updateMany({
          where: { tripId: booking.tripId, seatNumber: { in: booking.seatNumbers } },
          data: { status: 'AVAILABLE', bookingId: null, lockedAt: null, lockedBy: null },
        });

        await tx.trip.update({
          where: { id: booking.tripId },
          data: { availableSeats: { increment: booking.seatNumbers.length } },
        });
      });

      for (const seatNumber of booking.seatNumbers) {
        this.realtime.broadcastToTrip(booking.tripId, SocketEvent.SEAT_UPDATED, {
          tripId: booking.tripId,
          seatNumber,
          status: 'AVAILABLE',
        });
      }
    }
  }
}
