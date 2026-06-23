import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '@prisma/client';
import { SocketEvent, COMMISSION_RATE, GENIUS_PAY_RATE, NotificationType, PaymentMethod } from '@transpro/shared';
import { generateReference } from '@transpro/shared';
import axios from 'axios';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';

const GENIUSPAY_BASE = 'https://pay.genius.ci/api/v1/merchant';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly encryptionKey: string;

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private notifications: NotificationsService,
    private config: ConfigService,
    private push: PushService,
    private webhooks: WebhooksService,
  ) {
    const key = this.config.get<string>('ENCRYPTION_KEY');
    if (!key) throw new Error('[PaymentsService] ENCRYPTION_KEY manquante — démarrage refusé');
    this.encryptionKey = key;
  }

  async initiate(bookingId: string, passengerId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        trip: { include: { route: { include: { originCity: true, destinationCity: true } }, tenant: true } },
        passenger: true,
        payment: true,
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (!booking.trip) throw new NotFoundException('Voyage introuvable (données incohérentes)');
    if (booking.passengerId !== passengerId) throw new BadRequestException('Accès refusé');
    // Vérifie le statut AVANT expiresAt : le cron peut avoir déjà annulé la réservation
    if (booking.status !== 'PENDING') throw new BadRequestException('Réservation déjà traitée');
    if (booking.expiresAt && booking.expiresAt < new Date()) {
      // Double-sécurité : annuler si le cron n'a pas encore tourné
      // Annulation silencieuse (le cron peut déjà l'avoir fait)
      try {
        await this.prisma.booking.update({
          where: { id: bookingId, status: 'PENDING' },
          data: { status: 'CANCELLED', cancelReason: 'Expiration (initiate check)' },
        });
      } catch (_) {}
      throw new BadRequestException('Réservation expirée — veuillez en créer une nouvelle');
    }

    // Gestion des tentatives multiples
    if (booking.payment) {
      const p = booking.payment;
      // Paiement PROCESSING déjà initié avec un lien valide → retourner le lien existant
      if (p.status === 'PROCESSING' && p.providerRef) {
        const existing = p.providerData as any;
        if (existing?.checkout_url) {
          this.logger.log(`Returning existing checkout URL for booking ${bookingId}`);
          return { checkoutUrl: existing.checkout_url, reference: p.providerRef };
        }
      }
      // Paiement FAILED → on supprime et on réessaie
      if (p.status === 'FAILED') {
        await this.prisma.payment.delete({ where: { id: p.id } });
      } else {
        throw new BadRequestException('Paiement déjà initié');
      }
    }

    const geniusPayFee     = Math.round(booking.totalAmount * GENIUS_PAY_RATE);
    const commissionAmount = Math.round(booking.totalAmount * COMMISSION_RATE);
    const netAmount        = booking.totalAmount - geniusPayFee - commissionAmount;
    const transactionId = generateReference('PAY');
    const appUrl = this.config.get('FRONTEND_URL') || this.config.get('APP_URL') || 'http://localhost:3000';

    const origin = (booking.trip.route as any).originCity?.name ?? '';
    const dest   = (booking.trip.route as any).destinationCity?.name ?? '';

    this.logger.log(`Initiating GeniusPay for booking ${bookingId}, amount ${booking.totalAmount} XOF`);

    let geniusRes: any;
    try {
      geniusRes = await this.initiateGeniusPay({
        amount: booking.totalAmount,
        description: `Billet ${origin} → ${dest}`,
        customer: {
          name: `${booking.passenger.firstName} ${booking.passenger.lastName}`,
          email: booking.passenger.email,
          phone: booking.passenger.phone ?? '',
        },
        successUrl: `${appUrl}/passenger/payment/success?bookingId=${bookingId}`,
        errorUrl: `${appUrl}/passenger/payment/error?bookingId=${bookingId}`,
        metadata: { transactionId, bookingId },
      });
    } catch (err) {
      this.logger.error(`GeniusPay initiation failed for booking ${bookingId}`, err);
      throw err;
    }

    this.logger.log(`GeniusPay response for booking ${bookingId}: ${JSON.stringify(geniusRes)}`);

    if (!geniusRes?.checkout_url) {
      this.logger.error(`GeniusPay returned no checkout_url. Full response: ${JSON.stringify(geniusRes)}`);
      throw new BadRequestException('Lien de paiement non reçu du prestataire');
    }

    // Créer l'enregistrement Payment seulement après confirmation de GeniusPay
    try {
      await this.prisma.payment.create({
        data: {
          bookingId,
          tenantId: booking.tenantId,
          amount: booking.totalAmount,
          currency: 'XOF',
          method: 'GENIUS_PAY' as PaymentMethod,
          status: 'PROCESSING',
          transactionId,
          geniusPayFee,
          commissionAmount,
          netAmount,
          providerRef: geniusRes.reference,
          providerData: geniusRes as any,
        },
      });
    } catch (err: any) {
      // P2002 = unique constraint → payment créé par une requête concurrente
      if (err?.code === 'P2002') {
        const existing = await this.prisma.payment.findUnique({ where: { bookingId } });
        if (existing?.providerData) {
          const data = existing.providerData as any;
          if (data?.checkout_url) {
            return { checkoutUrl: data.checkout_url, reference: existing.providerRef };
          }
        }
        throw new BadRequestException('Paiement déjà en cours');
      }
      this.logger.error(`payment.create failed for booking ${bookingId}: ${err?.message}`, err?.stack);
      throw new InternalServerErrorException('Erreur lors de l\'enregistrement du paiement');
    }

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
    try {
      body = JSON.parse(rawBody);
    } catch (err: any) {
      this.logger.error(`[Webhook] Payload JSON invalide: ${err.message}`, rawBody.slice(0, 200));
      throw new BadRequestException('Webhook payload invalide — retry attendu');
    }

    const event: string = body.event;
    const transaction = body.data;

    if (event === 'payment.success') {
      const { transactionId } = transaction.metadata ?? {};
      if (!transactionId) return { received: true };

      const payment = await this.prisma.payment.findUnique({ where: { transactionId } });
      if (!payment || payment.status === 'SUCCESS') return { received: true };

      const paymentChannel = this._extractChannel(transaction);
      await this.confirmPayment(payment.bookingId, payment.id, paymentChannel, transaction);
    }

    if (event === 'payment.failed' || event === 'payment.expired' || event === 'payment.cancelled') {
      const { transactionId } = transaction.metadata ?? {};
      if (!transactionId) return { received: true };

      const payment = await this.prisma.payment.findUnique({
        where: { transactionId },
        include: { booking: { include: { trip: { select: { tenant: { select: { logo: true } } } } } } },
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
        templateData: {},
        data: { bookingId: payment.bookingId },
        companyLogo: (payment.booking as any)?.trip?.tenant?.logo ?? undefined,
      }).catch(() => {});
    }

    return { received: true };
  }

  async confirmPayment(bookingId: string, paymentId: string, paymentChannel?: string, webhookData?: any) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { include: { route: true, tenant: { select: { logo: true } } } }, passenger: true },
    });
    if (!booking) return;

    // Pré-génération des QR codes (CPU-bound, hors transaction)
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

    const paidAt = new Date();
    let alreadyConfirmed = false;

    await this.prisma.$transaction(async (tx) => {
      // Garde atomique : n'agit que si le paiement est encore PROCESSING.
      // Protège contre les doubles appels webhook (idempotence).
      const updated = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PROCESSING' },
        data: {
          status: 'SUCCESS',
          paidAt,
          ...(paymentChannel && { paymentChannel }),
          ...(webhookData && { providerData: webhookData }),
        },
      });

      if (updated.count === 0) {
        alreadyConfirmed = true;
        return; // Déjà confirmé — sortie sans erreur
      }

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CONFIRMED', confirmedAt: paidAt },
      });
      await tx.tripSeat.updateMany({
        where: { tripId: booking.tripId, seatNumber: { in: booking.seatNumbers } },
        data: { status: 'OCCUPIED', lockedAt: null, lockedBy: null },
      });
      const existingCount = await tx.ticket.count({ where: { bookingId } });
      if (existingCount === 0) {
        await tx.ticket.createMany({
          data: tickets.map((t) => ({
            bookingId,
            seatNumber: t.seatNumber,
            qrCode: t.qrCode,
            qrCodeData: t.qrCodeData,
          })),
        });
      }
    });

    if (alreadyConfirmed) {
      this.logger.log(`confirmPayment: booking ${bookingId} already confirmed — skipping`);
      return;
    }

    this.notifications.create({
      userId: booking.passengerId,
      type: NotificationType.PAYMENT_SUCCESS,
      templateData: {
        origin: (booking.trip.route as any).originCity?.name ?? '',
        destination: (booking.trip.route as any).destinationCity?.name ?? '',
      },
      data: { bookingId, reference: booking.reference },
      companyLogo: (booking.trip as any)?.tenant?.logo ?? undefined,
    }).catch(() => {});

    this.realtime.broadcastToCompany(booking.tenantId, SocketEvent.BOOKING_CREATED, {
      bookingId,
      tripId: booking.tripId,
    });

    // Webhook API tierce : notifier le consumer qui a créé la réservation via /ext.
    if ((booking as any).apiConsumerId) {
      this.webhooks.emitToConsumer((booking as any).apiConsumerId, WebhookEvent.BOOKING_CONFIRMED, {
        bookingId,
        reference: booking.reference,
        status: 'CONFIRMED',
        tripId: booking.tripId,
        seatNumbers: booking.seatNumbers,
        totalAmount: booking.totalAmount,
        confirmedAt: paidAt.toISOString(),
      }).catch(() => {});
    }

    // Web push dashboard : alerter le staff d'une nouvelle réservation confirmée
    this.push.sendWebPushToTenant(booking.tenantId, {
      title: 'Nouvelle réservation',
      message: `Réservation ${booking.reference} confirmée — siège(s) ${booking.seatNumbers.join(', ')}`,
      data: { type: 'BOOKING_CONFIRMED', bookingId, tripId: booking.tripId },
    }).catch(() => {});

    for (const seatNumber of booking.seatNumbers) {
      this.realtime.broadcastToTrip(booking.tripId, SocketEvent.SEAT_UPDATED, {
        tripId: booking.tripId,
        seatNumber,
        status: 'OCCUPIED',
      });
    }
  }

  async confirmNative(bookingId: string, passengerId: string, geniusPayReference: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.passengerId !== passengerId) throw new BadRequestException('Accès refusé');

    // Idempotence : déjà confirmé (webhook arrivé avant la confirmation mobile)
    if (booking.status === 'CONFIRMED') return { status: 'SUCCESS', updated: false };
    if (booking.status !== 'PENDING')   throw new BadRequestException('Réservation non payable');

    // Vérifier le paiement auprès de GeniusPay
    let gpData: any;
    try {
      const res = await axios.get(`${GENIUSPAY_BASE}/payments/${geniusPayReference}`, {
        headers: {
          'X-API-Key':    this.config.get('GENIUSPAY_API_KEY'),
          'X-API-Secret': this.config.get('GENIUSPAY_API_SECRET'),
        },
      });
      gpData = res.data?.data ?? res.data;
    } catch (err: any) {
      this.logger.error(`GeniusPay verify failed for ref ${geniusPayReference}: ${err?.message}`);
      throw new BadRequestException('Impossible de vérifier le paiement auprès de GeniusPay');
    }

    const gpStatus = (gpData?.status ?? '').toLowerCase();
    if (gpStatus !== 'completed' && gpStatus !== 'success' && gpStatus !== 'paid') {
      throw new BadRequestException(`Paiement non complété (statut: ${gpStatus})`);
    }

    const geniusPayFee     = Math.round(booking.totalAmount * GENIUS_PAY_RATE);
    const commissionAmount = Math.round(booking.totalAmount * COMMISSION_RATE);
    const netAmount        = booking.totalAmount - geniusPayFee - commissionAmount;
    const paymentChannel   = this._extractChannel(gpData);

    // Créer ou mettre à jour le Payment en DB
    let paymentId: string;
    if (booking.payment) {
      // Le webhook est déjà passé — utiliser le paiement existant
      paymentId = booking.payment.id;
      if (booking.payment.status === 'SUCCESS') {
        return { status: 'SUCCESS', updated: false };
      }
    } else {
      const payment = await this.prisma.payment.create({
        data: {
          bookingId,
          tenantId:        booking.tenantId,
          amount:          booking.totalAmount,
          currency:        'XOF',
          method:          'GENIUS_PAY' as any,
          status:          'PROCESSING',
          transactionId:   generateReference('PAY'),
          geniusPayFee,
          commissionAmount,
          netAmount,
          providerRef:     geniusPayReference,
          providerData:    gpData,
        },
      });
      paymentId = payment.id;
    }

    await this.confirmPayment(bookingId, paymentId, paymentChannel, gpData);
    return { status: 'SUCCESS', updated: true };
  }

  async confirmFromRedirect(bookingId: string, passengerId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { bookingId },
      include: { booking: { select: { passengerId: true } } },
    });

    if (!payment) throw new NotFoundException('Aucun paiement trouvé pour cette réservation');
    if (payment.booking.passengerId !== passengerId) throw new BadRequestException('Accès refusé');

    if (payment.status === 'SUCCESS') {
      return { status: 'SUCCESS', updated: false };
    }

    if (payment.status !== 'PROCESSING') {
      return { status: payment.status, updated: false };
    }

    this.logger.log(`Confirming payment ${payment.id} from GeniusPay redirect for booking ${bookingId}`);
    await this.confirmPayment(bookingId, payment.id);
    return { status: 'SUCCESS', updated: true };
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
    let gpData: any;
    try {
      const res = await axios.get(`${GENIUSPAY_BASE}/payments/${payment.providerRef}`, {
        headers: {
          'X-API-Key': this.config.get('GENIUSPAY_API_KEY'),
          'X-API-Secret': this.config.get('GENIUSPAY_API_SECRET'),
        },
      });
      // Genius Pay response: { success: true, data: { status: "pending|processing|completed|failed|expired", payment_method: "wave|orange_money|...", ... } }
      gpData   = res.data?.data;
      gpStatus = (gpData?.status ?? '').toLowerCase();
      this.logger.log(`GeniusPay status check for ${payment.providerRef}: "${gpStatus}" (raw: ${JSON.stringify(gpData)})`);
    } catch (err: any) {
      this.logger.warn(`GeniusPay status check failed: ${err?.message}`);
      return { status: payment.status, updated: false };
    }

    if (gpStatus === 'completed' || gpStatus === 'success' || gpStatus === 'paid') {
      const paymentChannel = this._extractChannel(gpData);
      await this.confirmPayment(payment.bookingId, payment.id, paymentChannel, gpData);
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

  async checkInTicket(ticketId: string, agentId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Billet introuvable');
    if (ticket.isScanned) throw new BadRequestException('Billet déjà embarqué');
    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: { isScanned: true, scannedAt: new Date(), scannedBy: agentId },
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
            trip: {
              include: {
                route: {
                  include: {
                    originCity:      true,
                    destinationCity: true,
                  },
                },
              },
            },
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

    const result = { valid: true, ticket, booking: ticket.booking };
    this.realtime.sendToUser(agentId, SocketEvent.TICKET_SCANNED, result);
    return result;
  }

  private async initiateGeniusPay(params: {
    amount: number;
    description: string;
    customer: { name: string; email: string; phone: string };
    successUrl: string;
    errorUrl: string;
    metadata: Record<string, any>;
  }) {
    const apiKey    = this.config.get('GENIUSPAY_API_KEY');
    const apiSecret = this.config.get('GENIUSPAY_API_SECRET');
    const body = {
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
    };
    this.logger.debug(`GeniusPay request → ${GENIUSPAY_BASE}/payments ${JSON.stringify(body)}`);

    try {
      const response = await axios.post(`${GENIUSPAY_BASE}/payments`, body, {
        headers: {
          'X-API-Key': apiKey,
          'X-API-Secret': apiSecret,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      });
      this.logger.debug(`GeniusPay raw response: ${JSON.stringify(response.data)}`);
      // Support both { data: {...} } and flat response shapes
      return response.data?.data ?? response.data;
    } catch (error: any) {
      this.logger.error(
        `GeniusPay HTTP error ${error?.response?.status}: ${JSON.stringify(error?.response?.data)}`,
      );
      const msg =
        error?.response?.data?.error?.message ??
        error?.response?.data?.message ??
        error?.message ??
        'Erreur lors de l\'initiation du paiement';
      throw new BadRequestException(msg);
    }
  }

  /** Extrait le canal de paiement depuis un objet de réponse Genius Pay. */
  private _extractChannel(data: any): string | undefined {
    // Genius Pay peut retourner le canal sous différents noms de champs
    const raw: string | undefined =
      data?.payment_method ??
      data?.channel ??
      data?.payment_channel ??
      data?.provider ??
      undefined;
    return raw ? raw.toLowerCase() : undefined;
  }

  private signTicket(data: object): string {
    return crypto
      .createHmac('sha256', this.encryptionKey)
      .update(JSON.stringify(data))
      .digest('hex');
  }
}
