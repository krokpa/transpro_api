import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetOpeningBalanceDto } from './dto/set-opening-balance.dto';
import { ClosePeriodDto } from './dto/close-period.dto';

@Injectable()
export class StationCashPeriodsService {
  constructor(private prisma: PrismaService) {}

  // ── Lecture ──────────────────────────────────────────────────────────────────

  async getCurrentPeriod(stationId: string, tenantId: string) {
    const now = new Date();
    return this.getOrCreate(stationId, tenantId, now.getFullYear(), now.getMonth() + 1);
  }

  async getPeriod(stationId: string, tenantId: string, year: number, month: number) {
    const period = await this.prisma.stationCashPeriod.findUnique({
      where: { stationId_year_month: { stationId, year, month } },
      include: {
        closedBy:    { select: { id: true, firstName: true, lastName: true } },
        validatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!period) return null;
    if (period.tenantId !== tenantId) throw new ForbiddenException();
    return period;
  }

  async getHistory(stationId: string, tenantId: string, limit = 12) {
    const station = await this.prisma.station.findFirst({ where: { id: stationId, tenantId } });
    if (!station) throw new NotFoundException('Gare introuvable');
    return this.prisma.stationCashPeriod.findMany({
      where: { stationId, tenantId },
      include: {
        closedBy:    { select: { id: true, firstName: true, lastName: true } },
        validatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: limit,
    });
  }

  // ── Recalcul automatique ──────────────────────────────────────────────────────
  // Appelé chaque fois qu'une dépense ou une provision change d'état

  async recalculate(stationId: string, tenantId: string, year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end   = new Date(Date.UTC(year, month,     0, 23, 59, 59, 999));

    const [expAgg, provAgg, bookings] = await Promise.all([
      this.prisma.expense.aggregate({
        where:  { stationId, tenantId, status: 'APPROVED', date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      this.prisma.cashProvision.aggregate({
        where:  { stationId, tenantId, status: 'RECEIVED', receivedAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      this.prisma.booking.findMany({
        where: {
          soldByStationId: stationId,
          tenantId,
          status: { in: ['CONFIRMED', 'COMPLETED'] },
          createdAt: { gte: start, lte: end },
        },
        select: { payment: { select: { amount: true, method: true, status: true } } },
      }),
    ]);

    const cashSales    = bookings
      .filter(b => b.payment?.method === 'CASH' && b.payment?.status === 'SUCCESS')
      .reduce((s, b) => s + (b.payment?.amount ?? 0), 0);
    const expensesOut  = expAgg._sum.amount  ?? 0;
    const provisionsIn = provAgg._sum.amount ?? 0;

    const period = await this.getOrCreate(stationId, tenantId, year, month);

    // Ne pas modifier les périodes déjà validées
    if (period.status === 'VALIDATED') return period;

    const computedBalance = period.openingBalance + cashSales + provisionsIn - expensesOut;

    return this.prisma.stationCashPeriod.update({
      where: { id: period.id },
      data: { cashSales, provisionsIn, expensesOut, computedBalance },
    });
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────

  async setOpeningBalance(
    stationId: string,
    tenantId: string,
    year: number,
    month: number,
    dto: SetOpeningBalanceDto,
    userId: string,
  ) {
    const period = await this.getOrCreate(stationId, tenantId, year, month);
    if (period.tenantId !== tenantId) throw new ForbiddenException();
    if (period.status === 'VALIDATED') {
      throw new BadRequestException('Impossible de modifier une période validée');
    }

    const computedBalance = dto.openingBalance + period.cashSales + period.provisionsIn - period.expensesOut;

    return this.prisma.stationCashPeriod.update({
      where: { id: period.id },
      data: {
        openingBalance: dto.openingBalance,
        computedBalance,
        notes: dto.notes ?? period.notes,
      },
    });
  }

  async closePeriod(
    stationId: string,
    tenantId: string,
    year: number,
    month: number,
    dto: ClosePeriodDto,
    userId: string,
  ) {
    const period = await this.getOrCreate(stationId, tenantId, year, month);
    if (period.tenantId !== tenantId) throw new ForbiddenException();
    if (period.status === 'VALIDATED') {
      throw new BadRequestException('Période déjà validée');
    }

    const variance = dto.declaredBalance - period.computedBalance;

    return this.prisma.stationCashPeriod.update({
      where: { id: period.id },
      data: {
        declaredBalance: dto.declaredBalance,
        variance,
        status:    'CLOSED',
        closedById: userId,
        closedAt:  new Date(),
        notes:     dto.notes ?? period.notes,
      },
      include: {
        closedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async validatePeriod(
    stationId: string,
    tenantId: string,
    year: number,
    month: number,
    userId: string,
  ) {
    const period = await this.prisma.stationCashPeriod.findUnique({
      where: { stationId_year_month: { stationId, year, month } },
    });
    if (!period)              throw new NotFoundException('Période introuvable');
    if (period.tenantId !== tenantId) throw new ForbiddenException();
    if (period.status !== 'CLOSED') {
      throw new BadRequestException('La période doit d\'abord être clôturée');
    }

    const updated = await this.prisma.stationCashPeriod.update({
      where: { id: period.id },
      data: {
        status:         'VALIDATED',
        validatedById:  userId,
        validatedAt:    new Date(),
      },
      include: {
        closedBy:    { select: { id: true, firstName: true, lastName: true } },
        validatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Report automatique : créer la période suivante avec l'ouverture = solde déclaré
    await this.carryForward(stationId, tenantId, year, month, period.declaredBalance ?? period.computedBalance);

    return updated;
  }

  async reopenPeriod(
    stationId: string,
    tenantId: string,
    year: number,
    month: number,
    userId: string,
  ) {
    const period = await this.prisma.stationCashPeriod.findUnique({
      where: { stationId_year_month: { stationId, year, month } },
    });
    if (!period) throw new NotFoundException('Période introuvable');
    if (period.tenantId !== tenantId) throw new ForbiddenException();
    if (period.status === 'OPEN') throw new BadRequestException('La période est déjà ouverte');
    if (period.status === 'VALIDATED') throw new BadRequestException('Impossible de rouvrir une période validée');

    return this.prisma.stationCashPeriod.update({
      where: { id: period.id },
      data: { status: 'OPEN', declaredBalance: null, variance: null, closedById: null, closedAt: null },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  async getOrCreate(stationId: string, tenantId: string, year: number, month: number) {
    const existing = await this.prisma.stationCashPeriod.findUnique({
      where: { stationId_year_month: { stationId, year, month } },
    });
    if (existing) return existing;

    // Report du solde du mois précédent
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;
    const prev = await this.prisma.stationCashPeriod.findUnique({
      where: { stationId_year_month: { stationId, year: prevYear, month: prevMonth } },
    });
    const openingBalance = prev?.declaredBalance ?? prev?.computedBalance ?? 0;

    return this.prisma.stationCashPeriod.create({
      data: { stationId, tenantId, year, month, openingBalance, computedBalance: openingBalance },
    });
  }

  private async carryForward(
    stationId: string,
    tenantId: string,
    year: number,
    month: number,
    closingBalance: number,
  ) {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear  = month === 12 ? year + 1 : year;

    const nextExists = await this.prisma.stationCashPeriod.findUnique({
      where: { stationId_year_month: { stationId, year: nextYear, month: nextMonth } },
    });

    if (nextExists) {
      // Mettre à jour l'ouverture seulement si la période suivante est encore OPEN
      if (nextExists.status === 'OPEN') {
        const newComputed = closingBalance + nextExists.cashSales + nextExists.provisionsIn - nextExists.expensesOut;
        await this.prisma.stationCashPeriod.update({
          where: { id: nextExists.id },
          data: { openingBalance: closingBalance, computedBalance: newComputed },
        });
      }
    } else {
      await this.prisma.stationCashPeriod.create({
        data: {
          stationId, tenantId,
          year: nextYear, month: nextMonth,
          openingBalance: closingBalance,
          computedBalance: closingBalance,
        },
      });
    }
  }
}
