import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProcessRefundDto, ProcessRefundAction } from './dto/refund.dto';

@Injectable()
export class RefundsService {
  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where: { tenantId },
        include: {
          booking: {
            select: {
              reference: true,
              totalAmount: true,
              passenger: { select: { firstName: true, lastName: true, phone: true } },
              trip: {
                select: {
                  departureAt: true,
                  route: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.refund.count({ where: { tenantId } }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findByPassenger(passengerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where: { booking: { passengerId } },
        include: {
          booking: {
            select: {
              reference: true,
              totalAmount: true,
              trip: {
                select: {
                  departureAt: true,
                  route: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.refund.count({ where: { booking: { passengerId } } }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, tenantId: string) {
    const refund = await this.prisma.refund.findFirst({
      where: { id, tenantId },
      include: {
        booking: {
          select: {
            reference: true,
            totalAmount: true,
            cancelReason: true,
            passenger: { select: { firstName: true, lastName: true, phone: true, email: true } },
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
        },
        payment: { select: { method: true, transactionId: true, paidAt: true } },
      },
    });

    if (!refund) throw new NotFoundException('Remboursement introuvable');
    return refund;
  }

  async process(id: string, tenantId: string, agentId: string, dto: ProcessRefundDto) {
    const refund = await this.prisma.refund.findFirst({ where: { id, tenantId } });
    if (!refund) throw new NotFoundException('Remboursement introuvable');
    if (refund.status !== 'PENDING' && refund.status !== 'PROCESSING') {
      throw new BadRequestException(`Remboursement déjà traité (statut: ${refund.status})`);
    }

    const newStatus = dto.action as string;

    const [updated] = await this.prisma.$transaction([
      this.prisma.refund.update({
        where: { id },
        data: {
          status: newStatus as any,
          processedById: agentId,
          processedAt: new Date(),
          notes: dto.notes,
          providerRef: dto.providerRef,
        },
      }),
      ...(dto.action === ProcessRefundAction.COMPLETED
        ? [
            this.prisma.payment.update({
              where: { id: refund.paymentId },
              data: { status: 'REFUNDED' },
            }),
          ]
        : []),
    ]);

    return updated;
  }

  /** Marque un remboursement comme en cours de traitement (pris en charge). */
  async startProcessing(id: string, tenantId: string, agentId: string) {
    const refund = await this.prisma.refund.findFirst({ where: { id, tenantId } });
    if (!refund) throw new NotFoundException('Remboursement introuvable');
    if (refund.status !== 'PENDING') {
      throw new BadRequestException('Le remboursement n\'est pas en attente');
    }

    return this.prisma.refund.update({
      where: { id },
      data: { status: 'PROCESSING', processedById: agentId },
    });
  }
}
