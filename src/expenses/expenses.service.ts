import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@transpro/shared';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: {
    stationId:   string;
    category:    string;
    description: string;
    amount:      number;
    date:        string;
    receiptNote?: string;
  }, user: any) {
    // Vérifier que la gare appartient au tenant
    const station = await this.prisma.station.findFirst({
      where: { id: dto.stationId, tenantId: user.tenantId },
    });
    if (!station) throw new NotFoundException('Gare introuvable');

    return this.prisma.expense.create({
      data: {
        tenantId:      user.tenantId,
        stationId:     dto.stationId,
        category:      dto.category as any,
        description:   dto.description,
        amount:        dto.amount,
        date:          new Date(dto.date),
        receiptNote:   dto.receiptNote,
        submittedById: user.sub,
        status:        'SUBMITTED',
      },
      include: {
        station:   { select: { id: true, name: true, code: true } },
        submitter: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async findAll(user: any, filters: {
    stationId?: string;
    status?:    string;
    category?:  string;
    from?:      string;
    to?:        string;
  }) {
    const where: any = { tenantId: user.tenantId };

    if (filters.stationId) where.stationId = filters.stationId;
    if (filters.status)    where.status    = filters.status;
    if (filters.category)  where.category  = filters.category;
    if (filters.from || filters.to) {
      where.date = {};
      if (filters.from) where.date.gte = new Date(filters.from);
      if (filters.to)   where.date.lte = new Date(filters.to);
    }

    // Agent ne voit que sa gare principale
    if (
      user.role === UserRole.COMPANY_AGENT &&
      !filters.stationId &&
      user.stationIds?.length
    ) {
      where.stationId = { in: user.stationIds };
    }

    return this.prisma.expense.findMany({
      where,
      include: {
        station:   { select: { id: true, name: true, code: true } },
        submitter: { select: { id: true, firstName: true, lastName: true } },
        approver:  { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string, user: any) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: {
        station:   { select: { id: true, name: true, code: true } },
        submitter: { select: { id: true, firstName: true, lastName: true } },
        approver:  { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!expense) throw new NotFoundException('Dépense introuvable');
    if (expense.tenantId !== user.tenantId) throw new ForbiddenException();
    return expense;
  }

  async approve(id: string, user: any) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Dépense introuvable');
    if (expense.tenantId !== user.tenantId) throw new ForbiddenException();
    if (expense.status !== 'SUBMITTED') {
      throw new BadRequestException(`Impossible d'approuver une dépense en statut "${expense.status}"`);
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        status:      'APPROVED',
        approvedById: user.sub,
        approvedAt:  new Date(),
        rejectedAt:  null,
        rejectedReason: null,
      },
      include: {
        station:   { select: { id: true, name: true } },
        submitter: { select: { id: true, firstName: true, lastName: true } },
        approver:  { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async reject(id: string, reason: string, user: any) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Dépense introuvable');
    if (expense.tenantId !== user.tenantId) throw new ForbiddenException();
    if (expense.status !== 'SUBMITTED') {
      throw new BadRequestException(`Impossible de rejeter une dépense en statut "${expense.status}"`);
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        status:         'REJECTED',
        approvedById:   user.sub,
        rejectedAt:     new Date(),
        rejectedReason: reason,
      },
      include: {
        station:   { select: { id: true, name: true } },
        submitter: { select: { id: true, firstName: true, lastName: true } },
        approver:  { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async stationSummary(stationId: string, tenantId: string, month?: string) {
    const now   = month ? new Date(month + '-01') : new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

    const [expenses, provisions, bookings] = await Promise.all([
      this.prisma.expense.findMany({
        where: { stationId, tenantId, date: { gte: start, lte: end } },
      }),
      this.prisma.cashProvision.findMany({
        where: { stationId, tenantId, status: 'RECEIVED', receivedAt: { gte: start, lte: end } },
      }),
      this.prisma.booking.findMany({
        where: {
          soldByStationId: stationId,
          tenantId,
          status: { in: ['CONFIRMED', 'COMPLETED'] },
          createdAt: { gte: start, lte: end },
        },
        include: { payment: { select: { amount: true, method: true, status: true } } },
      }),
    ]);

    const cashSales      = bookings
      .filter(b => b.payment?.method === 'CASH' && b.payment?.status === 'SUCCESS')
      .reduce((s, b) => s + (b.payment?.amount ?? 0), 0);
    const totalExpenses  = expenses.filter(e => e.status === 'APPROVED').reduce((s, e) => s + e.amount, 0);
    const totalProvisions = provisions.reduce((s, p) => s + p.amount, 0);
    const pendingExpenses = expenses.filter(e => e.status === 'SUBMITTED').reduce((s, e) => s + e.amount, 0);

    // Solde estimé = ventes cash + provisions reçues - dépenses approuvées
    const estimatedBalance = cashSales + totalProvisions - totalExpenses;

    const byCategory: Record<string, number> = {};
    expenses.filter(e => e.status === 'APPROVED').forEach(e => {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    });

    return {
      period: { start, end },
      cashSales,
      totalExpenses,
      totalProvisions,
      pendingExpenses,
      estimatedBalance,
      byCategory,
      expenseCount:   expenses.length,
      provisionCount: provisions.length,
    };
  }
}
