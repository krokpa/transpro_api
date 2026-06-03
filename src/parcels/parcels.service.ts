import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@transpro/shared';
import { calculateParcelFee, generateReference, PARCEL_MAX_WEIGHT_KG } from '@transpro/shared';
import { AddParcelPhotosDto, CreateParcelDto, ParcelFiltersDto, UpdateParcelStatusDto, CreateDeliveryRequestDto, UpdateDeliveryRequestDto } from './dto/parcel.dto';
import dayjs from 'dayjs';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { fr: string; en: string }> = {
  PENDING:    { fr: 'En attente',    en: 'Pending' },
  COLLECTED:  { fr: 'Pris en charge', en: 'Collected' },
  IN_TRANSIT: { fr: 'En transit',    en: 'In transit' },
  ARRIVED:    { fr: 'Arrivé',        en: 'Arrived' },
  DELIVERED:  { fr: 'Livré',         en: 'Delivered' },
  RETURNED:   { fr: 'Retourné',      en: 'Returned' },
};

const STATUS_MESSAGES_FR: Record<string, (deliveryCity: string) => string> = {
  COLLECTED:  (city) => `Votre colis a été pris en charge et est en route vers ${city}.`,
  IN_TRANSIT: (city) => `Votre colis est actuellement en transit vers ${city}.`,
  ARRIVED:    (city) => `Votre colis est arrivé à ${city}. Vous pouvez le récupérer à la gare.`,
  DELIVERED:  (city) => `Votre colis a été remis au destinataire à ${city}.`,
  RETURNED:   ()     => `Votre colis a été retourné à l'expéditeur.`,
};

// ── Parcel select preset ──────────────────────────────────────────────────────

const PARCEL_SELECT = {
  id: true,
  trackingCode: true,
  status: true,
  senderId: true,
  senderName: true,
  senderPhone: true,
  senderEmail: true,
  recipientId: true,
  recipientName: true,
  recipientPhone: true,
  recipientEmail: true,
  deliveryCity: true,
  description: true,
  weightKg: true,
  fragile: true,
  declaredValue: true,
  fee: true,
  currency: true,
  isPaid: true,
  paymentMethod: true,
  notes: true,
  photos: true,
  collectedAt: true,
  departedAt: true,
  arrivedAt: true,
  deliveredAt: true,
  returnedAt: true,
  createdAt: true,
  updatedAt: true,
  trip: {
    select: {
      id: true,
      departureAt: true,
      status: true,
      route: {
        select: {
          name: true,
          distanceKm: true,
          originCity: { select: { name: true } },
          destinationCity: { select: { name: true } },
        },
      },
    },
  },
  agent:     { select: { id: true, firstName: true, lastName: true, avatar: true } },
  sender:    { select: { id: true, firstName: true, lastName: true, avatar: true } },
  recipient: { select: { id: true, firstName: true, lastName: true, avatar: true } },
  station:   { select: { id: true, name: true } },
};

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ParcelsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private email: EmailService,
    private sms: SmsService,
    private config: ConfigService,
  ) {}

  // ── Create (guichet agent) ────────────────────────────────────────────────

  async create(
    tenantId: string,
    agentId: string,
    dto: CreateParcelDto,
    senderUser?: { id: string; firstName: string; lastName: string; phone: string; email: string },
  ) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: dto.tripId, tenantId },
      include: {
        route: { select: { distanceKm: true, originCity: { select: { name: true } } } },
      },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable');
    if (!['SCHEDULED', 'BOARDING'].includes(trip.status)) {
      throw new BadRequestException('Ce voyage n\'accepte plus de nouveaux colis');
    }
    if (dto.weightKg > PARCEL_MAX_WEIGHT_KG) {
      throw new BadRequestException(`Poids maximum autorisé : ${PARCEL_MAX_WEIGHT_KG} kg`);
    }

    const senderName  = senderUser
      ? `${senderUser.firstName} ${senderUser.lastName}`
      : (dto.senderName ?? '');
    const senderPhone = senderUser ? senderUser.phone : (dto.senderPhone ?? '');

    if (!senderName || !senderPhone) {
      throw new BadRequestException('Informations de l\'expéditeur requises');
    }

    const fee = dto.fee ?? calculateParcelFee(dto.weightKg, trip.route.distanceKm);
    const trackingCode = generateReference('TP-COL');

    // Auto-lookup recipient: use provided recipientId or match by phone
    let recipientId   = dto.recipientId ?? null;
    let recipientEmail = dto.recipientEmail ?? null;
    if (!recipientId && dto.recipientPhone) {
      const recipUser = await this.prisma.user.findUnique({
        where: { phone: dto.recipientPhone },
        select: { id: true, email: true },
      });
      if (recipUser) {
        recipientId    = recipUser.id;
        recipientEmail = recipientEmail ?? recipUser.email;
      }
    }

    const parcel = await this.prisma.parcel.create({
      data: {
        trackingCode,
        tenantId,
        tripId: dto.tripId,
        agentId,
        stationId:      dto.stationId,
        senderId:       senderUser?.id,
        senderName,
        senderPhone,
        senderEmail:    senderUser?.email ?? dto.senderEmail,
        recipientId,
        recipientName:  dto.recipientName,
        recipientPhone: dto.recipientPhone,
        recipientEmail,
        deliveryCity:   dto.deliveryCity,
        description:    dto.description,
        weightKg:       dto.weightKg,
        fragile:        dto.fragile ?? false,
        declaredValue:  dto.declaredValue,
        fee,
        currency:       'XOF',
        isPaid:         dto.isPaid ?? false,
        paymentMethod:  dto.paymentMethod,
        notes:          dto.notes,
        status:         'PENDING',
      },
      select: PARCEL_SELECT,
    });

    // Notify sender on creation
    this._notifyCreation(parcel, senderUser).catch(() => {});

    return parcel;
  }

  // ── Create as passenger ───────────────────────────────────────────────────

  async createAsPassenger(
    user: { id: string; firstName: string; lastName: string; phone: string; email: string },
    dto: CreateParcelDto,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      select: { tenantId: true },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable');
    return this.create(trip.tenantId, user.id, dto, user);
  }

  // ── Find all (tenant) ─────────────────────────────────────────────────────

  async findAll(tenantId: string, filters: ParcelFiltersDto) {
    const where: any = { tenantId };
    if (filters.tripId) where.tripId = filters.tripId;
    if (filters.status) where.status = filters.status;
    if (filters.date) {
      const start = dayjs(filters.date).startOf('day').toDate();
      const end   = dayjs(filters.date).endOf('day').toDate();
      where.createdAt = { gte: start, lte: end };
    }
    return this.prisma.parcel.findMany({
      where,
      select: PARCEL_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ── Find one ──────────────────────────────────────────────────────────────

  async findOne(id: string, tenantId: string) {
    const parcel = await this.prisma.parcel.findFirst({
      where: { id, tenantId },
      select: PARCEL_SELECT,
    });
    if (!parcel) throw new NotFoundException('Colis introuvable');
    return parcel;
  }

  // ── Track by code (public) ────────────────────────────────────────────────

  async trackByCode(trackingCode: string) {
    const parcel = await this.prisma.parcel.findUnique({
      where: { trackingCode },
      select: {
        trackingCode: true,
        status: true,
        senderName: true,
        recipientName: true,
        deliveryCity: true,
        description: true,
        weightKg: true,
        fragile: true,
        collectedAt: true,
        departedAt: true,
        arrivedAt: true,
        deliveredAt: true,
        returnedAt: true,
        createdAt: true,
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
          },
        },
      },
    });
    if (!parcel) throw new NotFoundException('Aucun colis trouvé pour ce code');
    return parcel;
  }

  // ── Find by sender (passenger) ────────────────────────────────────────────

  async findBySender(senderId: string) {
    return this.prisma.parcel.findMany({
      where: { senderId },
      select: PARCEL_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ── Find by recipient (passenger) ─────────────────────────────────────────
  // Matches parcels where the authenticated user is the recipient —
  // either by recipientId (registered) or by recipientPhone (unregistered at time of send).

  async findByRecipient(userId: string, phone: string) {
    return this.prisma.parcel.findMany({
      where: {
        OR: [
          { recipientId: userId },
          { recipientPhone: phone },
        ],
      },
      select: PARCEL_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ── Find by trip ──────────────────────────────────────────────────────────

  async findByTrip(tripId: string, tenantId: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId } });
    if (!trip) throw new NotFoundException('Voyage introuvable');
    return this.prisma.parcel.findMany({
      where: { tripId },
      select: PARCEL_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Update status ─────────────────────────────────────────────────────────

  async updateStatus(id: string, tenantId: string, dto: UpdateParcelStatusDto) {
    const parcel = await this.prisma.parcel.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        senderId: true,
        senderName: true,
        senderPhone: true,
        senderEmail: true,
        recipientId: true,
        recipientName: true,
        recipientPhone: true,
        recipientEmail: true,
        trackingCode: true,
        deliveryCity: true,
      },
    });
    if (!parcel) throw new NotFoundException('Colis introuvable');

    this._validateTransition(parcel.status, dto.status);

    const updated = await this.prisma.parcel.update({
      where: { id },
      data: {
        status: dto.status as any,
        notes: dto.notes ?? undefined,
        ...this._statusTimestamps(dto.status),
      },
      select: PARCEL_SELECT,
    });

    // Notify sender
    this._notifyStatusChange(parcel, dto.status).catch(() => {});

    return updated;
  }

  // ── Fee estimation ────────────────────────────────────────────────────────

  async estimateFee(tripId: string, weightKg: number) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { route: { select: { distanceKm: true } } },
    });
    if (!trip) throw new NotFoundException('Voyage introuvable');
    return { fee: calculateParcelFee(weightKg, trip.route.distanceKm), currency: 'XOF' };
  }

  // ── Photos (agent) ────────────────────────────────────────────────────────

  async addPhotos(id: string, tenantId: string, dto: AddParcelPhotosDto) {
    const parcel = await this.prisma.parcel.findFirst({
      where: { id, tenantId },
      select: { id: true, photos: true },
    });
    if (!parcel) throw new NotFoundException('Colis introuvable');
    if (dto.photos.length > 2) throw new BadRequestException('Maximum 2 photos par colis');

    return this.prisma.parcel.update({
      where: { id },
      data: { photos: dto.photos },
      select: PARCEL_SELECT,
    });
  }

  // ── Private: notification dispatch ───────────────────────────────────────

  private _trackingUrl(trackingCode: string): string {
    const base = this.config.get('APP_URL', 'https://app.transpro.ci');
    return `${base}/passenger/parcel/${trackingCode}`;
  }

  private async _notifyCreation(
    parcel: any,
    senderUser?: { id: string; email: string },
  ) {
    const trackingUrl = this._trackingUrl(parcel.trackingCode);

    if (senderUser) {
      // Registered passenger: push notification + email
      await this.notifications.create({
        userId: senderUser.id,
        type: NotificationType.PARCEL_COLLECTED,
        templateData: {
          trackingCode: parcel.trackingCode,
          deliveryCity: parcel.deliveryCity,
        },
        data: { trackingCode: parcel.trackingCode, parcelId: parcel.id },
      }).catch(() => {});

      await this.email.sendParcelCreated(senderUser.email, {
        senderName:   parcel.senderName,
        trackingCode: parcel.trackingCode,
        description:  parcel.description,
        weightKg:     parcel.weightKg,
        deliveryCity: parcel.deliveryCity,
        fee:          parcel.fee,
        trackingUrl,
      });
    } else {
      // Unregistered: SMS + optional email
      await this.sms.send(parcel.senderPhone, this.sms.parcelCreated(parcel.trackingCode, parcel.deliveryCity));

      if (parcel.senderEmail) {
        await this.email.sendParcelCreated(parcel.senderEmail, {
          senderName:   parcel.senderName,
          trackingCode: parcel.trackingCode,
          description:  parcel.description,
          weightKg:     parcel.weightKg,
          deliveryCity: parcel.deliveryCity,
          fee:          parcel.fee,
          trackingUrl,
        });
      }
    }
  }

  private async _notifyStatusChange(
    parcel: { id: string; senderId: string | null; senderName: string; senderPhone: string; senderEmail: string | null; recipientId?: string | null; recipientName?: string; recipientPhone?: string; recipientEmail?: string | null; trackingCode: string; deliveryCity: string; status: string },
    newStatus: string,
  ) {
    const notifType  = this._notifType(newStatus);
    const label      = STATUS_LABELS[newStatus]?.fr ?? newStatus;
    const msgFn      = STATUS_MESSAGES_FR[newStatus];
    const message    = msgFn ? msgFn(parcel.deliveryCity) : `Votre colis est maintenant : ${label}.`;
    const trackingUrl = this._trackingUrl(parcel.trackingCode);

    if (parcel.senderId) {
      // Registered passenger: push (via NotificationsService) + email
      if (notifType) {
        await this.notifications.create({
          userId: parcel.senderId,
          type: notifType,
          templateData: {
            trackingCode: parcel.trackingCode,
            deliveryCity: parcel.deliveryCity,
          },
          data: { trackingCode: parcel.trackingCode, parcelId: parcel.id },
        }).catch(() => {});
      }

      // Fetch registered user's email
      const user = await this.prisma.user.findUnique({
        where: { id: parcel.senderId },
        select: { email: true },
      });
      if (user?.email) {
        await this.email.sendParcelStatusUpdate(user.email, {
          senderName:   parcel.senderName,
          trackingCode: parcel.trackingCode,
          status:       newStatus,
          statusLabel:  label,
          deliveryCity: parcel.deliveryCity,
          message,
          trackingUrl,
        });
      }
    } else {
      // Unregistered: SMS + optional email
      const smsMsg = this._smsMessage(newStatus, parcel.trackingCode, parcel.deliveryCity);
      if (smsMsg) await this.sms.send(parcel.senderPhone, smsMsg);

      if (parcel.senderEmail) {
        await this.email.sendParcelStatusUpdate(parcel.senderEmail, {
          senderName:   parcel.senderName,
          trackingCode: parcel.trackingCode,
          status:       newStatus,
          statusLabel:  label,
          deliveryCity: parcel.deliveryCity,
          message,
          trackingUrl,
        });
      }
    }

    // Notify registered recipient on ARRIVED and DELIVERED
    if (parcel.recipientId && ['ARRIVED', 'DELIVERED'].includes(newStatus)) {
      const recipUser = await this.prisma.user.findUnique({
        where: { id: parcel.recipientId },
        select: { email: true },
      });
      if (notifType) {
        await this.notifications.create({
          userId: parcel.recipientId,
          type: notifType,
          templateData: { trackingCode: parcel.trackingCode, deliveryCity: parcel.deliveryCity },
          data: { trackingCode: parcel.trackingCode, parcelId: parcel.id },
        }).catch(() => {});
      }
      if (recipUser?.email) {
        await this.email.sendParcelStatusUpdate(recipUser.email, {
          senderName:   parcel.recipientName ?? parcel.senderName,
          trackingCode: parcel.trackingCode,
          status:       newStatus,
          statusLabel:  label,
          deliveryCity: parcel.deliveryCity,
          message,
          trackingUrl,
        }).catch(() => {});
      }
    } else if (!parcel.recipientId && parcel.recipientPhone && ['ARRIVED', 'DELIVERED'].includes(newStatus)) {
      // Unregistered recipient: SMS
      const smsMsg = this._smsMessage(newStatus, parcel.trackingCode, parcel.deliveryCity);
      if (smsMsg) await this.sms.send(parcel.recipientPhone, smsMsg).catch(() => {});
    }
  }

  // ── Private: helpers ──────────────────────────────────────────────────────

  private _validateTransition(current: string, next: string) {
    const allowed: Record<string, string[]> = {
      PENDING:    ['COLLECTED', 'RETURNED'],
      COLLECTED:  ['IN_TRANSIT', 'RETURNED'],
      IN_TRANSIT: ['ARRIVED', 'RETURNED'],
      ARRIVED:    ['DELIVERING', 'DELIVERED', 'RETURNED'],
      DELIVERING: ['DELIVERED', 'ARRIVED', 'RETURNED'],
      DELIVERED:  [],
      RETURNED:   [],
    };
    if (!allowed[current]?.includes(next)) {
      throw new BadRequestException(`Transition invalide : ${current} → ${next}`);
    }
  }

  private _statusTimestamps(status: string): Record<string, Date> {
    const now = new Date();
    const map: Record<string, Record<string, Date>> = {
      COLLECTED:  { collectedAt: now },
      IN_TRANSIT: { departedAt: now },
      ARRIVED:    { arrivedAt: now },
      DELIVERING: { arrivedAt: now },
      DELIVERED:  { deliveredAt: now },
      RETURNED:   { returnedAt: now },
    };
    return map[status] ?? {};
  }

  // ── Delivery request ──────────────────────────────────────────────────────

  private readonly DR_SELECT = {
    id: true,
    parcelId: true,
    tenantId: true,
    address: true,
    district: true,
    landmark: true,
    latitude: true,
    longitude: true,
    contactName: true,
    contactPhone: true,
    handlerId: true,
    deliveryNotes: true,
    failReason: true,
    deliveryFee: true,
    isPaid: true,
    paymentMethod: true,
    status: true,
    assignedAt: true,
    enRouteAt: true,
    deliveredAt: true,
    failedAt: true,
    cancelledAt: true,
    createdAt: true,
    updatedAt: true,
    handler: { select: { id: true, firstName: true, lastName: true, avatar: true } },
    parcel: {
      select: {
        id: true,
        trackingCode: true,
        status: true,
        senderName: true,
        senderPhone: true,
        recipientName: true,
        recipientPhone: true,
        deliveryCity: true,
        description: true,
        weightKg: true,
      },
    },
  };

  async createDeliveryRequest(
    parcelId: string,
    tenantId: string,
    dto: CreateDeliveryRequestDto,
  ) {
    const parcel = await this.prisma.parcel.findFirst({
      where: { id: parcelId, tenantId },
      select: { id: true, status: true, senderId: true },
    });
    if (!parcel) throw new NotFoundException('Colis introuvable');
    if (!['ARRIVED', 'DELIVERING'].includes(parcel.status)) {
      throw new BadRequestException('La livraison à domicile n\'est disponible que lorsque le colis est arrivé à destination');
    }

    const existing = await this.prisma.parcelDeliveryRequest.findUnique({ where: { parcelId } });
    if (existing && !['CANCELLED', 'FAILED'].includes(existing.status)) {
      throw new BadRequestException('Une demande de livraison est déjà en cours pour ce colis');
    }

    const req = await this.prisma.parcelDeliveryRequest.upsert({
      where: { parcelId },
      update: { ...dto, status: 'PENDING', handlerId: null, deliveredAt: null, failedAt: null, cancelledAt: null, enRouteAt: null, assignedAt: null },
      create: { parcelId, tenantId, ...dto },
      select: this.DR_SELECT,
    });
    return req;
  }

  async createDeliveryRequestByCode(
    trackingCode: string,
    dto: CreateDeliveryRequestDto,
  ) {
    const parcel = await this.prisma.parcel.findUnique({
      where: { trackingCode },
      select: { id: true, tenantId: true, status: true },
    });
    if (!parcel) throw new NotFoundException('Colis introuvable');
    return this.createDeliveryRequest(parcel.id, parcel.tenantId, dto);
  }

  async getDeliveryRequest(parcelId: string, tenantId: string) {
    const req = await this.prisma.parcelDeliveryRequest.findFirst({
      where: { parcelId, tenantId },
      select: this.DR_SELECT,
    });
    if (!req) throw new NotFoundException('Aucune demande de livraison pour ce colis');
    return req;
  }

  async getDeliveryRequestByCode(trackingCode: string) {
    const parcel = await this.prisma.parcel.findUnique({
      where: { trackingCode },
      select: { id: true, tenantId: true },
    });
    if (!parcel) throw new NotFoundException('Colis introuvable');
    const req = await this.prisma.parcelDeliveryRequest.findUnique({
      where: { parcelId: parcel.id },
      select: this.DR_SELECT,
    });
    return req ?? null;
  }

  async listDeliveryRequests(tenantId: string, status?: string) {
    const where: any = { tenantId };
    if (status) where.status = status;
    return this.prisma.parcelDeliveryRequest.findMany({
      where,
      select: this.DR_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async updateDeliveryRequest(id: string, tenantId: string, dto: UpdateDeliveryRequestDto) {
    const req = await this.prisma.parcelDeliveryRequest.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, parcelId: true },
    });
    if (!req) throw new NotFoundException('Demande introuvable');

    const now = new Date();
    const timestamps: any = {};
    let parcelStatus: string | null = null;

    if (dto.status) {
      switch (dto.status) {
        case 'ASSIGNED':  timestamps.assignedAt = now; break;
        case 'EN_ROUTE':  timestamps.enRouteAt  = now; parcelStatus = 'DELIVERING'; break;
        case 'DELIVERED': timestamps.deliveredAt = now; parcelStatus = 'DELIVERED'; break;
        case 'FAILED':    timestamps.failedAt   = now; parcelStatus = 'ARRIVED'; break;
        case 'CANCELLED': timestamps.cancelledAt = now; break;
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.parcelDeliveryRequest.update({
        where: { id },
        data: { ...dto, ...timestamps },
        select: this.DR_SELECT,
      }),
      ...(parcelStatus ? [this.prisma.parcel.update({
        where: { id: req.parcelId },
        data: { status: parcelStatus as any, ...this._statusTimestamps(parcelStatus) },
      })] : []),
    ]);
    return updated;
  }

  async createDeliveryRequestByParcelAndUser(
    parcelId: string,
    userId: string,
    dto: CreateDeliveryRequestDto,
  ) {
    const parcel = await this.prisma.parcel.findUnique({
      where: { id: parcelId },
      select: { id: true, tenantId: true, senderId: true, recipientId: true, status: true },
    });
    if (!parcel) throw new NotFoundException('Colis introuvable');
    // Allow sender or registered recipient to request delivery
    if (parcel.senderId !== userId && parcel.recipientId !== userId) {
      throw new BadRequestException('Vous n\'avez pas accès à ce colis');
    }
    return this.createDeliveryRequest(parcelId, parcel.tenantId, dto);
  }

  async getDeliveryRequestForUser(parcelId: string, userId: string, tenantId?: string) {
    const parcel = await this.prisma.parcel.findUnique({
      where: { id: parcelId },
      select: { id: true, tenantId: true, senderId: true, recipientId: true },
    });
    if (!parcel) throw new NotFoundException('Colis introuvable');
    // Agent/owner can see any, passengers only their own
    const effectiveTenantId = tenantId ?? parcel.tenantId;
    return this.getDeliveryRequest(parcelId, effectiveTenantId);
  }

  async cancelDeliveryRequestByUser(parcelId: string, userId: string) {
    const parcel = await this.prisma.parcel.findUnique({
      where: { id: parcelId },
      select: { id: true, tenantId: true, senderId: true, recipientId: true },
    });
    if (!parcel) throw new NotFoundException('Colis introuvable');
    if (parcel.senderId !== userId && parcel.recipientId !== userId) {
      throw new BadRequestException('Accès non autorisé');
    }
    return this.cancelDeliveryRequest(parcelId, parcel.tenantId);
  }

  async cancelDeliveryRequest(parcelId: string, tenantId: string) {
    const req = await this.prisma.parcelDeliveryRequest.findFirst({
      where: { parcelId, tenantId },
      select: { id: true, status: true },
    });
    if (!req) throw new NotFoundException('Demande introuvable');
    if (['DELIVERED', 'CANCELLED'].includes(req.status)) {
      throw new BadRequestException('Cette demande ne peut plus être annulée');
    }
    return this.prisma.parcelDeliveryRequest.update({
      where: { id: req.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      select: this.DR_SELECT,
    });
  }

  private _notifType(status: string): NotificationType | null {
    const map: Record<string, NotificationType> = {
      COLLECTED:  NotificationType.PARCEL_COLLECTED,
      IN_TRANSIT: NotificationType.PARCEL_IN_TRANSIT,
      ARRIVED:    NotificationType.PARCEL_ARRIVED,
      DELIVERED:  NotificationType.PARCEL_DELIVERED,
    };
    return map[status] ?? null;
  }

  private _smsMessage(status: string, trackingCode: string, deliveryCity: string): string | null {
    const map: Record<string, (tc: string, city: string) => string> = {
      COLLECTED:  (tc, city) => this.sms.parcelCollected(tc, city),
      IN_TRANSIT: (tc, city) => this.sms.parcelInTransit(tc, city),
      ARRIVED:    (tc, city) => this.sms.parcelArrived(tc, city),
      DELIVERED:  (tc, city) => this.sms.parcelDelivered(tc, city),
    };
    return map[status]?.(trackingCode, deliveryCity) ?? null;
  }
}
