import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddBagPhotosDto, DeclareLuggageDto, ReportMissingDto } from './dto/luggage.dto';
import { generateReference } from '@transpro/shared';

const FREE_WEIGHT_DEFAULT = 20;   // kg
const EXCESS_RATE_XOF     = 300;  // FCFA par kg excédentaire

const BAG_SELECT = {
  id: true,
  qrCode: true,
  label: true,
  weightKg: true,
  status: true,
  photos: true,
  loadedAt: true,
  arrivedAt: true,
  claimedAt: true,
  missingAt: true,
  missingNote: true,
  createdAt: true,
};

const LUGGAGE_SELECT = {
  id: true,
  bookingId: true,
  tripId: true,
  tenantId: true,
  bagCount: true,
  totalWeightKg: true,
  freeWeightKg: true,
  excessWeightKg: true,
  excessFeeXof: true,
  excessPaid: true,
  excessPaymentMethod: true,
  agentId: true,
  createdAt: true,
  updatedAt: true,
  agent: { select: { id: true, firstName: true, lastName: true } },
  bags: { select: BAG_SELECT, orderBy: { createdAt: 'asc' as const } },
  booking: {
    select: {
      id: true,
      reference: true,
      seatNumbers: true,
      passenger: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
  },
};

@Injectable()
export class LuggageService {
  constructor(private prisma: PrismaService) {}

  // ── Declare / update luggage for a booking ────────────────────────────────

  async declare(tenantId: string, agentId: string, dto: DeclareLuggageDto) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: dto.bookingId, tenantId },
      select: { id: true, tripId: true, status: true },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (!['CONFIRMED', 'PENDING'].includes(booking.status)) {
      throw new BadRequestException('Cette réservation n\'accepte plus de déclaration de bagages');
    }

    const freeKg   = dto.freeWeightKg ?? FREE_WEIGHT_DEFAULT;
    const totalKg  = dto.totalWeightKg ?? 0;
    const excessKg = Math.max(0, totalKg - freeKg);
    const excessFee = Math.round(excessKg * EXCESS_RATE_XOF);

    // Upsert the luggage declaration
    const existing = await this.prisma.bookingLuggage.findUnique({
      where: { bookingId: dto.bookingId },
      select: { id: true, bags: { select: { id: true, status: true } } },
    });

    let luggageId: string;
    if (existing) {
      // Update existing: remove only DECLARED bags, keep loaded/arrived/claimed/missing
      const removableBags = existing.bags
        .filter((b) => b.status === 'DECLARED')
        .map((b) => b.id);
      if (removableBags.length) {
        await this.prisma.luggageBag.deleteMany({ where: { id: { in: removableBags } } });
      }
      await this.prisma.bookingLuggage.update({
        where: { id: existing.id },
        data: {
          bagCount: dto.bagCount,
          totalWeightKg: totalKg,
          freeWeightKg:  freeKg,
          excessWeightKg: excessKg,
          excessFeeXof:  excessFee,
          excessPaid:    dto.excessPaid ?? false,
          excessPaymentMethod: dto.excessPaymentMethod,
          agentId,
        },
      });
      luggageId = existing.id;
    } else {
      const created = await this.prisma.bookingLuggage.create({
        data: {
          bookingId: dto.bookingId,
          tripId:    booking.tripId,
          tenantId,
          agentId,
          bagCount:      dto.bagCount,
          totalWeightKg: totalKg,
          freeWeightKg:  freeKg,
          excessWeightKg: excessKg,
          excessFeeXof:  excessFee,
          excessPaid:    dto.excessPaid ?? false,
          excessPaymentMethod: dto.excessPaymentMethod,
        },
        select: { id: true },
      });
      luggageId = created.id;
    }

    // Create bags with QR codes
    if (dto.bagCount > 0) {
      const bagData = Array.from({ length: dto.bagCount }, (_, i) => ({
        luggageId,
        qrCode:   generateReference('LG'),
        label:    dto.bagLabels?.[i] ?? null,
        weightKg: dto.bagWeights?.[i] ?? null,
      }));
      await this.prisma.luggageBag.createMany({ data: bagData });
    }

    return this.prisma.bookingLuggage.findUnique({
      where: { id: luggageId },
      select: LUGGAGE_SELECT,
    });
  }

  // ── Get luggage for a booking ─────────────────────────────────────────────

  async getByBooking(bookingId: string, tenantId: string) {
    const luggage = await this.prisma.bookingLuggage.findFirst({
      where: { bookingId, tenantId },
      select: LUGGAGE_SELECT,
    });
    if (!luggage) throw new NotFoundException('Aucune déclaration de bagage pour cette réservation');
    return luggage;
  }

  async getByBookingPublic(bookingId: string) {
    const luggage = await this.prisma.bookingLuggage.findUnique({
      where: { bookingId },
      select: LUGGAGE_SELECT,
    });
    return luggage;
  }

  // ── Get all luggage for a trip ────────────────────────────────────────────

  async getByTrip(tripId: string, tenantId: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId } });
    if (!trip) throw new NotFoundException('Voyage introuvable');
    return this.prisma.bookingLuggage.findMany({
      where: { tripId, tenantId },
      select: LUGGAGE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Scan a bag QR (status transition) ────────────────────────────────────

  async scanBag(qrCode: string, tenantId: string) {
    const bag = await this.prisma.luggageBag.findUnique({
      where: { qrCode },
      include: {
        luggage: {
          select: {
            tenantId: true,
            booking: {
              select: {
                reference: true,
                passenger: { select: { firstName: true, lastName: true } },
                seatNumbers: true,
              },
            },
          },
        },
      },
    });
    if (!bag) throw new NotFoundException(`Aucun bagage trouvé pour le code : ${qrCode}`);
    if (bag.luggage.tenantId !== tenantId) {
      throw new BadRequestException('Ce bagage n\'appartient pas à votre compagnie');
    }

    // Determine next status
    const transitions: Record<string, string> = {
      DECLARED: 'LOADED',
      LOADED:   'ARRIVED',
      ARRIVED:  'CLAIMED',
    };
    const next = transitions[bag.status];
    if (!next) {
      throw new BadRequestException(
        bag.status === 'CLAIMED'
          ? 'Ce bagage a déjà été récupéré'
          : bag.status === 'MISSING'
          ? 'Ce bagage est signalé manquant — veuillez traiter la réclamation'
          : `Transition invalide depuis l'état : ${bag.status}`,
      );
    }

    const now = new Date();
    const timestamps: Record<string, Date> = {
      LOADED:  { loadedAt:  now } as any,
      ARRIVED: { arrivedAt: now } as any,
      CLAIMED: { claimedAt: now } as any,
    };

    const updated = await this.prisma.luggageBag.update({
      where: { id: bag.id },
      data:  { status: next as any, ...timestamps[next] },
      select: { ...BAG_SELECT },
    });

    return {
      bag: updated,
      booking: bag.luggage.booking,
    };
  }

  // ── Report a missing bag ──────────────────────────────────────────────────

  async reportMissing(bagId: string, tenantId: string, dto: ReportMissingDto) {
    const bag = await this.prisma.luggageBag.findUnique({
      where: { id: bagId },
      include: { luggage: { select: { tenantId: true } } },
    });
    if (!bag) throw new NotFoundException('Sac introuvable');
    if (bag.luggage.tenantId !== tenantId) {
      throw new BadRequestException('Accès non autorisé');
    }
    if (bag.status === 'CLAIMED') {
      throw new ConflictException('Ce sac a déjà été récupéré');
    }
    return this.prisma.luggageBag.update({
      where: { id: bagId },
      data: { status: 'MISSING', missingAt: new Date(), missingNote: dto.note },
      select: BAG_SELECT,
    });
  }

  // ── Report missing by QR code (passenger, public) ─────────────────────────

  async reportMissingByQr(qrCode: string, dto: ReportMissingDto) {
    const bag = await this.prisma.luggageBag.findUnique({ where: { qrCode }, select: { id: true, luggage: { select: { tenantId: true } } } });
    if (!bag) throw new NotFoundException('Sac introuvable');
    return this.reportMissing(bag.id, bag.luggage.tenantId, dto);
  }

  // ── All luggage of tenant (management view) ───────────────────────────────

  async findAll(tenantId: string, filters: { tripId?: string; status?: string }) {
    const where: any = { tenantId };
    if (filters.tripId) where.tripId = filters.tripId;
    if (filters.status) {
      where.bags = { some: { status: filters.status } };
    }
    return this.prisma.bookingLuggage.findMany({
      where,
      select: LUGGAGE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ── Photos d'un sac (agent) ───────────────────────────────────────────────

  async addBagPhotos(bagId: string, tenantId: string, dto: AddBagPhotosDto) {
    const bag = await this.prisma.luggageBag.findUnique({
      where: { id: bagId },
      include: { luggage: { select: { tenantId: true } } },
    });
    if (!bag) throw new NotFoundException('Sac introuvable');
    if (bag.luggage.tenantId !== tenantId) {
      throw new BadRequestException('Accès non autorisé');
    }
    if (dto.photos.length > 2) {
      throw new BadRequestException('Maximum 2 photos par sac');
    }
    return this.prisma.luggageBag.update({
      where: { id: bagId },
      data: { photos: dto.photos },
      select: BAG_SELECT,
    });
  }
}
