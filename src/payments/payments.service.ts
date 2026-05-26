import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SocketEvent, COMMISSION_RATE, NotificationType, PaymentMethod } from '@transpro/shared';
import { generateReference } from '@transpro/shared';
import axios from 'axios';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';

const GENIUSPAY_BASE = 'https://pay.genius.ci/api/v1/merchant';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

  async initiate(bookingId: string, passengerId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        trip: { include: { route: true, tenant: true } },
        passenger: true,
        payment: true,
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.passengerId !== passengerId) throw new BadRequestException('Accès refusé');
    if (booking.status !== 'PENDING') throw new BadRequestException('Réservation déjà traitée');
    if (booking.payment) throw new BadRequestException('Paiement déjà initié');
    if (booking.expiresAt < new Date()) throw new BadRequestException('Réservation expirée');

    const commissionAmount = Math.round(booking.totalAmount * COMMISSION_RATE);
    const netAmount = booking.totalAmount - commissionAmount;
    const transactionId = generateReference('PAY');

    const payment = await this.prisma.payment.create({
      data: {
        bookingId,
        tenantId: booking.tenantId,
        amount: booking.totalAmount,
        currency: 'XOF',
        method: 'GENIUS_PAY' as PaymentMethod,
        status: 'PROCESSING',
        transactionId,
        commissionAmount,
        netAmount,
      },
    });

    const appUrl = this.config.get('APP_URL', 'http://localhost:3000');
    const geniusRes = await this.initiateGeniusPay({
      amount: booking.totalAmount,
      description: `Billet ${(booking.trip.route as any).originCity?.name ?? ''} → ${(booking.trip.route as any).destinationCity?.name ?? ''}`,
      customer: {
        name: `${booking.passenger.firstName} ${booking.passenger.lastName}`,
        email: booking.passenger.email,
        phone: booking.passenger.phone,
      },
      successUrl: `${appUrl}/passenger/payment/success?bookingId=${bookingId}`,
      errorUrl: `${appUrl}/passenger/payment/error?bookingId=${bookingId}`,
      metadata: { transactionId, bookingId },
    });

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerRef: geniusRes.reference, providerData: geniusRes as any },
    });

    return { checkoutUrl: geniusRes.checkout_url, reference: geniusRes.reference };
  }

  async handleGeniusPayWebhook(rawBody: string, rawSignature: string, timestamp: string) {
    const webhookSecret = this.config.get('GENIUSPAY_WEBHOOK_SECRET', '');

    if (webhookSecret && rawSignature) {
      const data = `${timestamp}.${rawBody}`;
      const expectedSig = crypto.createHmac('sha256', webhookSecret).update(data).digest('hex');
      const sigBuf = Buffer.from(rawSignature, 'hex');
      const expBuf = Buffer.from(expectedSig, 'hex');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new UnauthorizedException('Signature webhook invalide');
      }
      if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) {
        throw new BadRequestException('Webhook expiré');
      }
    }

    let body: any;
    try { body = JSON.parse(rawBody); } catch { return { received: true }; }

    const event: string = body.event;
    const transaction = body.data;

    if (event === 'payment.success') {
      const { transactionId } = transaction.metadata ?? {};
      if (!transactionId) return { received: true };

      const payment = await this.prisma.payment.findUnique({ where: { transactionId } });
      if (!payment || payment.status === 'SUCCESS') return { received: true };

      await this.confirmPayment(payment.bookingId, payment.id);
    }

    if (event === 'payment.failed' || event === 'payment.expired' || event === 'payment.cancelled') {
      const { transactionId } = transaction.metadata ?? {};
      if (!transactionId) return { received: true };

      const payment = await this.prisma.payment.findUnique({
        where: { transactionId },
        include: { booking: true },
      });
      if (!payment || payment.status !== 'PROCESSING') return { received: true };

      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failedAt: new Date(), failReason: event },
        }),
        this.prisma.tripSeat.updateMany({
          where: { tripId: payment.booking.tripId, seatNumber: { in: payment.booking.seatNumbers } },
          data: { status: 'AVAILABLE', bookingId: null, lockedAt: null, lockedBy: null },
        }),
        this.prisma.trip.update({
          where: { id: payment.booking.tripId },
          data: { availableSeats: { increment: payment.booking.seatNumbers.length } },
        }),
        this.prisma.booking.update({
          where: { id: payment.bookingId },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        }),
      ]);

      this.notifications.create({
        userId: payment.booking.passengerId,
        type: NotificationType.PAYMENT_FAILED,
        title: 'Paiement échoué',
        message: 'Votre paiement n\'a pas abouti. Les sièges ont été libérés.',
        data: { bookingId: payment.bookingId },
      }).catch(() => {});
    }

    return { received: true };
  }

  async confirmPayment(bookingId: string, paymentId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { include: { route: true } }, passenger: true },
    });
    if (!booking) return;

    const tickets = await Promise.all(
      booking.seatNumbers.map(async (seatNumber) => {
        const ticketData = {
          bookingRef: booking.reference,
          tripId: booking.tripId,
          seatNumber,
          passengerId: booking.passengerId,
          issuedAt: new Date().toISOString(),
        };
        const signature = this.signTicket(ticketData);
        const qrData = JSON.stringify({ ...ticketData, sig: signature });
        const qrCode = await QRCode.toDataURL(qrData);
        return { seatNumber, qrCode, qrCodeData: qrData };
      }),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'SUCCESS', paidAt: new Date() },
      });
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      await tx.tripSeat.updateMany({
        where: { tripId: booking.tripId, seatNumber: { in: booking.seatNumbers } },
        data: { status: 'OCCUPIED', lockedAt: null, lockedBy: null },
      });
      await tx.ticket.createMany({
        data: tickets.map((t) => ({
          bookingId,
          seatNumber: t.seatNumber,
          qrCode: t.qrCode,
          qrCodeData: t.qrCodeData,
        })),
      });
    });

    this.notifications.create({
      userId: booking.passengerId,
      type: NotificationType.PAYMENT_SUCCESS,
      title: 'Paiement confirmé !',
      message: `Votre billet ${(booking.trip.route as any).originCity?.name ?? ''} → ${(booking.trip.route as any).destinationCity?.name ?? ''} est prêt.`,
      data: { bookingId, reference: booking.reference },
    }).catch(() => {});

    this.realtime.broadcastToCompany(booking.tenantId, SocketEvent.BOOKING_CREATED, {
      bookingId,
      tripId: booking.tripId,
    });

    for (const seatNumber of booking.seatNumbers) {
      this.realtime.broadcastToTrip(booking.tripId, SocketEvent.SEAT_UPDATED, {
        tripId: booking.tripId,
        seatNumber,
        status: 'OCCUPIED',
      });
    }
  }

  async checkStatus(paymentId: string, passengerId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { passengerId: true } } },
    });
    if (!payment) throw new NotFoundException('Transaction introuvable');
    if (payment.booking.passengerId !== passengerId) throw new BadRequestException('Accès refusé');
    return this.resolveGeniusPayStatus(payment);
  }

  async checkStatusByBooking(bookingId: string, passengerId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { bookingId },
      include: { booking: { select: { passengerId: true } } },
    });
    if (!payment) throw new NotFoundException('Aucun paiement trouvé pour cette réservation');
    if (payment.booking.passengerId !== passengerId) throw new BadRequestException('Accès refusé');
    return this.resolveGeniusPayStatus(payment);
  }

  private async resolveGeniusPayStatus(payment: any) {
    if (payment.status !== 'PROCESSING') {
      return { status: payment.status, updated: false };
    }
    if (!payment.providerRef) {
      return { status: payment.status, updated: false };
    }

    let gpStatus: string;
    try {
      const res = await axios.get(`${GENIUSPAY_BASE}/payments/${payment.providerRef}`, {
        headers: {
          'X-API-Key': this.config.get('GENIUSPAY_API_KEY'),
          'X-API-Secret': this.config.get('GENIUSPAY_API_SECRET'),
        },
      });
      // Genius Pay response: { success: true, data: { status: "pending|processing|completed|failed|expired", ... } }
      gpStatus = (res.data?.data?.status ?? '').toLowerCase();
    } catch {
      return { status: payment.status, updated: false };
    }

    if (gpStatus === 'completed') {
      await this.confirmPayment(payment.bookingId, payment.id);
      return { status: 'SUCCESS', updated: true };
    }

    if (gpStatus === 'failed' || gpStatus === 'expired') {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failedAt: new Date(), failReason: `payment.${gpStatus}` },
        }),
        this.prisma.booking.update({
          where: { id: payment.bookingId },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        }),
      ]);
      return { status: 'FAILED', updated: true };
    }

    // pending / processing — pas encore résolu côté Genius Pay
    return { status: payment.status, updated: false };
  }

  async findByPassenger(userId: string) {
    return this.prisma.payment.findMany({
      where: { booking: { passengerId: userId } },
      include: {
        booking: {
          select: {
            reference: true,
            seatNumbers: true,
            totalAmount: true,
            status: true,
            trip: {
              select: {
                departureAt: true,
                route: {
                  select: {
                    name: true,
                    originCity: { select: { name: true } },
                    destinationCity: { select: { name: true } },
                  },
                },
                tenant: { select: { name: true, logo: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async scanTicket(qrData: string, agentId: string) {
    let parsed: any;
    try {
      parsed = JSON.parse(qrData);
    } catch {
      throw new BadRequestException('QR code invalide');
    }

    const { sig, ...data } = parsed;
    const expectedSig = this.signTicket(data);
    if (sig !== expectedSig) throw new BadRequestException('QR code falsifié');

    const ticket = await this.prisma.ticket.findFirst({
      where: { qrCodeData: qrData },
      include: {
        booking: {
          include: {
            trip: { include: { route: true } },
            passenger: { select: { firstName: true, lastName: true, phone: true } },
          },
        },
      },
    });

    if (!ticket) throw new NotFoundException('Billet introuvable');
    if (ticket.isScanned) throw new BadRequestException('Ce billet a déjà été scanné');
    if (ticket.booking.status !== 'CONFIRMED') throw new BadRequestException('Réservation non confirmée');

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { isScanned: true, scannedAt: new Date(), scannedBy: agentId },
    });

    return { valid: true, ticket, booking: ticket.booking };
  }

  private async initiateGeniusPay(params: {
    amount: number;
    description: string;
    customer: { name: string; email: string; phone: string };
    successUrl: string;
    errorUrl: string;
    metadata: Record<string, any>;
  }) {
    try {
      const response = await axios.post(
        `${GENIUSPAY_BASE}/payments`,
        {
          amount: params.amount,
          currency: 'XOF',
          description: params.description,
          customer: {
            name: params.customer.name,
            email: params.customer.email,
            phone: params.customer.phone,
            country: 'CI',
          },
          success_url: params.successUrl,
          error_url: params.errorUrl,
          metadata: params.metadata,
        },
        {
          headers: {
            'X-API-Key': this.config.get('GENIUSPAY_API_KEY'),
            'X-API-Secret': this.config.get('GENIUSPAY_API_SECRET'),
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data.data;
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message ?? 'Erreur lors de l\'initiation du paiement';
      throw new BadRequestException(msg);
    }
  }

  private signTicket(data: object): string {
    return crypto
      .createHmac('sha256', this.config.get('ENCRYPTION_KEY', 'default-key'))
      .update(JSON.stringify(data))
      .digest('hex');
  }
}
