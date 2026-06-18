import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@transpro/shared';
import * as XLSX from 'xlsx';
import { StatementOutput, buildPdfFromExpenses, CAT_LBL } from './expenses.pdf';
import { extractBranding, parseLogo } from '../common/pdf-branding.helper';
import { StationCashPeriodsService } from '../station-cash-periods/station-cash-periods.service';

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private cashPeriods: StationCashPeriodsService,
  ) {}

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

    const updated = await this.prisma.expense.update({
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

    const d = new Date(expense.date);
    this.cashPeriods.recalculate(expense.stationId, expense.tenantId, d.getUTCFullYear(), d.getUTCMonth() + 1).catch(() => {});
    return updated;
  }

  async reject(id: string, reason: string, user: any) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Dépense introuvable');
    if (expense.tenantId !== user.tenantId) throw new ForbiddenException();
    if (expense.status !== 'SUBMITTED') {
      throw new BadRequestException(`Impossible de rejeter une dépense en statut "${expense.status}"`);
    }

    const updated = await this.prisma.expense.update({
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

    const d = new Date(expense.date);
    this.cashPeriods.recalculate(expense.stationId, expense.tenantId, d.getUTCFullYear(), d.getUTCMonth() + 1).catch(() => {});
    return updated;
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

  // ── Export relevé caisse gare ────────────────────────────────────────────────

  async exportStationStatement(
    stationId: string,
    tenantId: string,
    from: string,
    to: string,
    format: 'pdf' | 'xlsx',
  ): Promise<StatementOutput> {
    const start = new Date(from + '-01');
    const endD  = new Date(to + '-01');
    endD.setMonth(endD.getMonth() + 1);
    endD.setDate(0);
    endD.setUTCHours(23, 59, 59, 999);

    const [station, tenantForBranding] = await Promise.all([
      this.prisma.station.findFirst({ where: { id: stationId, tenantId }, select: { name: true } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { logo: true, settings: true } }),
    ]);
    if (!station) throw new NotFoundException('Gare introuvable');

    const [expensesRaw, provisionsRaw, bookings] = await Promise.all([
      this.prisma.expense.findMany({
        where: { stationId, tenantId, status: 'APPROVED', date: { gte: start, lte: endD } },
        include: {
          approver:  { select: { firstName: true, lastName: true } },
          submitter: { select: { firstName: true, lastName: true } },
        },
        orderBy: { date: 'asc' },
      }),
      this.prisma.cashProvision.findMany({
        where: { stationId, tenantId, status: 'RECEIVED', receivedAt: { gte: start, lte: endD } },
        orderBy: { receivedAt: 'asc' },
      }),
      this.prisma.booking.findMany({
        where: {
          soldByStationId: stationId,
          tenantId,
          status: { in: ['CONFIRMED', 'COMPLETED'] },
          createdAt: { gte: start, lte: endD },
        },
        include: { payment: { select: { amount: true, method: true, status: true } } },
      }),
    ]);

    const cashSales        = bookings.filter(b => b.payment?.method === 'CASH' && b.payment?.status === 'SUCCESS').reduce((s, b) => s + (b.payment?.amount ?? 0), 0);
    const totalExpenses    = expensesRaw.reduce((s, e) => s + e.amount, 0);
    const totalProvisions  = provisionsRaw.reduce((s, p) => s + p.amount, 0);
    const estimatedBalance = cashSales + totalProvisions - totalExpenses;

    const byCategory: Record<string, number> = {};
    expensesRaw.forEach(e => { byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount; });

    const period = from === to ? from : `${from} → ${to}`;
    const stationName = station.name;

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();

      // Sheet 1 — Résumé
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Relevé de caisse', '', stationName],
        ['Période', period, ''],
        ['Généré le', new Date().toLocaleDateString('fr-FR'), ''],
        [],
        ['RÉSUMÉ'],
        ['Ventes espèces (FCFA)',             cashSales],
        ['Approvisionnements reçus (FCFA)',   totalProvisions],
        ['Dépenses approuvées (FCFA)',        totalExpenses],
        ['Solde estimé (FCFA)',               estimatedBalance],
      ]), 'Résumé');

      // Sheet 2 — Dépenses
      const expHeaders = ['Date', 'Catégorie', 'Description', 'Montant (FCFA)', 'Soumis par', 'Approuvé par'];
      const expRows = expensesRaw.map(e => [
        new Date(e.date).toLocaleDateString('fr-FR'),
        (CAT_LBL as any)[e.category] ?? e.category,
        e.description,
        e.amount,
        e.submitter ? `${e.submitter.firstName} ${e.submitter.lastName}` : '',
        e.approver  ? `${e.approver.firstName} ${e.approver.lastName}` : '',
      ]);
      expRows.push(['TOTAL', '', '', totalExpenses, '', '']);
      const wsExp = XLSX.utils.aoa_to_sheet([expHeaders, ...expRows]);
      wsExp['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 40 }, { wch: 16 }, { wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsExp, 'Dépenses');

      // Sheet 3 — Approvisionnements
      const provHeaders = ['Date réception', 'Motif', 'Notes', 'Montant (FCFA)'];
      const provRows = provisionsRaw.map(p => [
        p.receivedAt ? new Date(p.receivedAt).toLocaleDateString('fr-FR') : '',
        p.reason ?? '',
        p.notes  ?? '',
        p.amount,
      ]);
      provRows.push(['TOTAL', '', '', totalProvisions]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([provHeaders, ...provRows]), 'Approvisionnements');

      // Sheet 4 — Répartition
      const catHeaders = ['Catégorie', 'Montant (FCFA)', 'Part (%)'];
      const catRows = Object.entries(byCategory).sort(([, a], [, b]) => b - a).map(([cat, amt]) => [
        (CAT_LBL as any)[cat] ?? cat,
        amt,
        totalExpenses > 0 ? `${((amt / totalExpenses) * 100).toFixed(1)}%` : '0.0%',
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([catHeaders, ...catRows]), 'Par catégorie');

      const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
      return {
        buffer,
        filename: `releve-caisse-${stationName.toLowerCase().replace(/\s/g, '-')}-${from}-${to}.xlsx`,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    const brandingSettings = extractBranding(tenantForBranding?.settings);
    const buffer = await buildPdfFromExpenses({
      stationName,
      period,
      from,
      to,
      cashSales,
      totalExpenses,
      totalProvisions,
      estimatedBalance,
      byCategory,
      expenses: expensesRaw,
      provisions: provisionsRaw,
      branding: { logo: parseLogo(tenantForBranding?.logo), settings: brandingSettings },
    });

    return {
      buffer,
      filename: `releve-caisse-${stationName.toLowerCase().replace(/\s/g, '-')}-${from}-${to}.pdf`,
      mimetype: 'application/pdf',
    };
  }
}
