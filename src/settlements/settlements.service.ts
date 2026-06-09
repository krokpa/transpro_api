import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@transpro/shared';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
  ) {}

  @Cron('0 2 1 * *')
  async computeMonthlySettlements() {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const periodEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));

    this.logger.log(`Computing settlements for ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`);

    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    for (const tenant of tenants) {
      try {
        await this.computeForTenant(tenant.id, periodStart, periodEnd);
      } catch (err: any) {
        this.logger.error(`Settlement failed for tenant ${tenant.id}: ${err?.message}`);
      }
    }
  }

  async computeForTenant(tenantId: string, periodStart: Date, periodEnd: Date) {
    const dayEnd = new Date(periodEnd);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        method: 'GENIUS_PAY',
        status: 'SUCCESS',
        paidAt: { gte: periodStart, lte: dayEnd },
        settlementItem: null,
      },
    });

    if (payments.length === 0) {
      this.logger.debug(`No unsettled payments for tenant ${tenantId}`);
      return null;
    }

    const totalAmount   = payments.reduce((s, p) => s + p.amount, 0);
    const geniusPayFees = payments.reduce((s, p) => s + p.geniusPayFee, 0);
    const commissions   = payments.reduce((s, p) => s + p.commissionAmount, 0);
    const netAmount     = payments.reduce((s, p) => s + p.netAmount, 0);

    const settlement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.settlement.create({
        data: {
          tenantId,
          periodStart,
          periodEnd,
          status: 'PENDING',
          totalAmount,
          geniusPayFees,
          commissions,
          netAmount,
          currency: 'XOF',
          itemCount: payments.length,
        },
      });

      await tx.settlementItem.createMany({
        data: payments.map((p) => ({
          settlementId:     created.id,
          paymentId:        p.id,
          amount:           p.amount,
          geniusPayFee:     p.geniusPayFee,
          commissionAmount: p.commissionAmount,
          netAmount:        p.netAmount,
        })),
      });

      return created;
    });

    this.logger.log(
      `Settlement ${settlement.id} created for tenant ${tenantId}: net=${netAmount} XOF (${payments.length} payments)`,
    );
    return settlement;
  }

  async findAll(user: any, filters: { tenantId?: string; status?: string }) {
    if (user.role === UserRole.SUPER_ADMIN) {
      return this.prisma.settlement.findMany({
        where: {
          ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
          ...(filters.status   ? { status: filters.status as any } : {}),
        },
        include: { tenant: { select: { id: true, name: true, slug: true } } },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      });
    }

    if (!user.tenantId) throw new ForbiddenException();
    return this.prisma.settlement.findMany({
      where: {
        tenantId: user.tenantId,
        ...(filters.status ? { status: filters.status as any } : {}),
      },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string, user: any) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        items: {
          include: {
            payment: {
              select: {
                id: true, amount: true, method: true, paidAt: true, paymentChannel: true,
                booking: {
                  select: {
                    reference: true,
                    trip: {
                      select: {
                        departureAt: true,
                        route: {
                          select: {
                            originCity:      { select: { name: true } },
                            destinationCity: { select: { name: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!settlement) throw new NotFoundException('Reversement introuvable');
    if (user.role !== UserRole.SUPER_ADMIN && settlement.tenantId !== user.tenantId) {
      throw new ForbiddenException('Accès refusé');
    }
    return settlement;
  }

  async markProcessing(id: string, dto: { bankName?: string; bankAccount?: string }, adminId: string) {
    const settlement = await this.prisma.settlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException('Reversement introuvable');
    if (settlement.status !== 'PENDING') {
      throw new ForbiddenException(`Impossible de traiter un reversement en statut "${settlement.status}"`);
    }

    return this.prisma.settlement.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        bankName: dto.bankName,
        bankAccount: dto.bankAccount,
        processedById: adminId,
      },
    });
  }

  async markPaid(id: string, dto: { transferRef: string }, adminId: string) {
    const settlement = await this.prisma.settlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException('Reversement introuvable');
    if (settlement.status !== 'PROCESSING') {
      throw new ForbiddenException(`Impossible de valider un reversement en statut "${settlement.status}"`);
    }

    const updated = await this.prisma.settlement.update({
      where: { id },
      data: {
        status: 'PAID',
        transferRef: dto.transferRef,
        processedAt: new Date(),
        processedById: adminId,
      },
    });

    // Notification email au propriétaire de la compagnie
    this.notifySettlementPaid(settlement.tenantId, settlement, dto.transferRef).catch(() => {});

    return updated;
  }

  async markFailed(id: string, dto: { notes?: string }, adminId: string) {
    const settlement = await this.prisma.settlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException('Reversement introuvable');

    const updated = await this.prisma.settlement.update({
      where: { id },
      data: {
        status: 'FAILED',
        notes: dto.notes,
        processedById: adminId,
      },
    });

    // Notification email au propriétaire de la compagnie
    this.notifySettlementFailed(settlement.tenantId, settlement, dto.notes).catch(() => {});

    return updated;
  }

  async submitBankDetails(id: string, dto: { bankName: string; bankAccount: string; notes?: string }, tenantId: string) {
    const settlement = await this.prisma.settlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException('Reversement introuvable');
    if (settlement.tenantId !== tenantId) throw new ForbiddenException('Accès refusé');
    if (settlement.status === 'PAID') {
      throw new ForbiddenException('Ce reversement a déjà été effectué');
    }

    return this.prisma.settlement.update({
      where: { id },
      data: {
        bankName:    dto.bankName,
        bankAccount: dto.bankAccount,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
    });
  }

  async mySummary(tenantId: string) {
    const settlements = await this.prisma.settlement.findMany({
      where: { tenantId },
      orderBy: { periodStart: 'desc' },
      take: 24,
    });

    const totalPaid       = settlements.filter(s => s.status === 'PAID').reduce((a, s) => a + s.netAmount, 0);
    const totalPending    = settlements.filter(s => s.status === 'PENDING').reduce((a, s) => a + s.netAmount, 0);
    const totalProcessing = settlements.filter(s => s.status === 'PROCESSING').reduce((a, s) => a + s.netAmount, 0);
    const totalFees       = settlements.reduce((a, s) => a + s.geniusPayFees, 0);
    const totalCommission = settlements.reduce((a, s) => a + s.commissions, 0);
    const totalGross      = settlements.reduce((a, s) => a + s.totalAmount, 0);

    const monthly = settlements.slice(0, 12).map(s => ({
      period:        s.periodStart,
      label:         new Date(s.periodStart).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
      totalAmount:   s.totalAmount,
      netAmount:     s.netAmount,
      geniusPayFees: s.geniusPayFees,
      commissions:   s.commissions,
      status:        s.status,
    })).reverse();

    return { totalPaid, totalPending, totalProcessing, totalFees, totalCommission, totalGross, monthly, count: settlements.length };
  }

  async triggerManual(tenantId: string, year: number, month: number, adminId: string) {
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd   = new Date(Date.UTC(year, month, 0));

    const existing = await this.prisma.settlement.findFirst({
      where: { tenantId, periodStart, periodEnd },
    });
    if (existing) {
      throw new ForbiddenException(`Un reversement existe déjà pour cette période (id: ${existing.id})`);
    }

    this.logger.log(`Manual settlement trigger by ${adminId} for tenant ${tenantId}, ${year}-${String(month).padStart(2, '0')}`);
    return this.computeForTenant(tenantId, periodStart, periodEnd);
  }

  // ── Notifications privées ────────────────────────────────────────────────────

  private async notifySettlementPaid(tenantId: string, settlement: any, transferRef: string) {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'COMPANY_OWNER' },
      select: { email: true, firstName: true, tenant: { select: { name: true } } },
    });
    if (!owner) return;

    const frontendUrl = this.config.get('FRONTEND_URL', 'https://app.transpro.ci');
    const periodLabel = new Date(settlement.periodStart).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    await this.email.sendSettlementPaid(owner.email, {
      firstName:    owner.firstName,
      companyName:  (owner as any).tenant?.name ?? '',
      periodLabel,
      netAmount:    settlement.netAmount,
      transferRef,
      dashboardUrl: `${frontendUrl}/dashboard/settlements/${settlement.id}`,
    });
  }

  private async notifySettlementFailed(tenantId: string, settlement: any, notes?: string) {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'COMPANY_OWNER' },
      select: { email: true, firstName: true, tenant: { select: { name: true } } },
    });
    if (!owner) return;

    const frontendUrl = this.config.get('FRONTEND_URL', 'https://app.transpro.ci');
    const periodLabel = new Date(settlement.periodStart).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    await this.email.sendSettlementFailed(owner.email, {
      firstName:    owner.firstName,
      companyName:  (owner as any).tenant?.name ?? '',
      periodLabel,
      netAmount:    settlement.netAmount,
      notes,
      dashboardUrl: `${frontendUrl}/dashboard/settlements/${settlement.id}`,
    });
  }
}
