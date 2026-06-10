import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@transpro/shared';
import * as XLSX from 'xlsx';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDoc = require('pdfkit') as typeof import('pdfkit');

// ─── Shared PDF helpers (inline, minimal) ────────────────────────────────────
const M = 40; const CW = 515; const DARK = '#1e293b'; const GR = '#6b7280'; const LT = '#f8fafc';
function fmtXOF(n: number) { return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`; }
function fmtD(d: Date | string) { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function pdfHdr(doc: any, title: string, sub: string, company: string) {
  doc.fillColor('#f05a1a').rect(M, 30, CW, 3).fill();
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15).text(company, M, 44, { width: 260, lineBreak: false });
  doc.fillColor('#f05a1a').font('Helvetica-Bold').fontSize(11).text(title, M + 255, 46, { width: 260, align: 'right', lineBreak: false });
  doc.fillColor(GR).font('Helvetica').fontSize(9).text(sub, M, 67, { width: 300, lineBreak: false })
    .text(`Généré le ${fmtD(new Date())}`, M + 255, 67, { width: 260, align: 'right', lineBreak: false });
  doc.moveTo(M, 83).lineTo(M + CW, 83).strokeColor('#e2e8f0').lineWidth(1).stroke();
  return 96;
}
function pdfTH(doc: any, cols: { t: string; w: number }[], y: number) {
  doc.fillColor(DARK).rect(M, y, CW, 20).fill();
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7);
  let x = M; for (const c of cols) { doc.text(c.t.toUpperCase(), x + 5, y + 6, { width: c.w - 10, lineBreak: false }); x += c.w; }
  return y + 20;
}
function pdfTR(doc: any, cells: string[], cols: { t: string; w: number }[], y: number, even: boolean) {
  if (even) doc.fillColor(LT).rect(M, y, CW, 18).fill();
  doc.fillColor('#374151').font('Helvetica').fontSize(7.5);
  let x = M; for (let i = 0; i < cols.length; i++) { doc.text(cells[i] ?? '', x + 5, y + 4, { width: cols[i].w - 10, lineBreak: false, ellipsis: true }); x += cols[i].w; }
  doc.moveTo(M, y + 17.5).lineTo(M + CW, y + 17.5).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
  return y + 18;
}
function pdfTotal(doc: any, cells: string[], cols: { t: string; w: number }[], y: number) {
  doc.fillColor(DARK).rect(M, y, CW, 21).fill();
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
  let x = M; for (let i = 0; i < cols.length; i++) { doc.text(cells[i] ?? '', x + 5, y + 6, { width: cols[i].w - 10, lineBreak: false }); x += cols[i].w; }
  return y + 21;
}
function pdfKpiRow(doc: any, kpis: { label: string; value: string; sub?: string }[], y: number) {
  const n = kpis.length; const bw = Math.floor((CW - 8 * (n - 1)) / n);
  kpis.forEach((k, i) => {
    const x = M + i * (bw + 8);
    doc.fillColor('#f1f5f9').roundedRect(x, y, bw, 50, 5).fill();
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(12).text(k.value, x + 8, y + 8, { width: bw - 16, lineBreak: false });
    doc.fillColor(GR).font('Helvetica').fontSize(7.5).text(k.label, x + 8, y + 26, { width: bw - 16, lineBreak: false });
    if (k.sub) doc.fillColor('#f05a1a').font('Helvetica').fontSize(7).text(k.sub, x + 8, y + 38, { width: bw - 16, lineBreak: false });
  });
  return y + 64;
}
function pdfSection(doc: any, title: string, y: number) {
  doc.fillColor('#f05a1a').font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), M, y, { width: CW });
  doc.moveTo(M, y + 14).lineTo(M + CW, y + 14).strokeColor('#fed7aa').lineWidth(1).stroke();
  return y + 22;
}
async function buildPdf(fn: (doc: any) => void): Promise<Buffer> {
  const doc = new PDFDoc({ margin: M, bufferPages: true, size: 'A4' });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((res, rej) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => res(Buffer.concat(chunks)));
    doc.on('error', rej);
  });
  fn(doc);
  const rng = doc.bufferedPageRange();
  for (let i = 0; i < rng.count; i++) {
    doc.switchToPage(rng.start + i);
    doc.fillColor(GR).font('Helvetica').fontSize(7.5).text(
      `TransPro CI  ·  Page ${i + 1} / ${rng.count}`,
      M, doc.page.height - 26, { width: CW, align: 'center', lineBreak: false },
    );
  }
  doc.end();
  return done;
}
export interface StatementOutput { buffer: Buffer; filename: string; mimetype: string; }

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

  // ── Export relevé compagnie ──────────────────────────────────────────────────

  async exportStatement(
    tenantId: string,
    from: string,
    to: string,
    format: 'pdf' | 'xlsx',
  ): Promise<StatementOutput> {
    const periodStart = new Date(from + '-01');
    const periodEnd   = new Date(to + '-01');
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(0); // dernier jour du mois "to"

    const [tenant, settlements] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, sigle: true, phone: true },
      }),
      this.prisma.settlement.findMany({
        where: {
          tenantId,
          periodStart: { gte: new Date(from + '-01') },
          periodEnd:   { lte: new Date(to + '-01T23:59:59') },
        },
        orderBy: { periodStart: 'asc' },
      }),
    ]);

    const company = (tenant as any)?.sigle ?? tenant?.name ?? 'Compagnie';
    const period  = from === to ? from : `${from} → ${to}`;

    const totalGross = settlements.reduce((s, r) => s + r.totalAmount, 0);
    const totalFees  = settlements.reduce((s, r) => s + r.geniusPayFees, 0);
    const totalComm  = settlements.reduce((s, r) => s + r.commissions, 0);
    const totalNet   = settlements.reduce((s, r) => s + r.netAmount, 0);

    const STATUS_LBL: Record<string, string> = {
      PENDING: 'En attente', PROCESSING: 'En cours', PAID: 'Payé', FAILED: 'Échoué',
    };
    const MONTH_FR = ['Janv.','Févr.','Mars','Avr.','Mai','Juin','Juil.','Août','Sept.','Oct.','Nov.','Déc.'];
    const periodLabel = (s: any) => {
      const d = new Date(s.periodStart);
      return `${MONTH_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();

      // Sheet 1 — Résumé
      const summaryData = [
        ['Relevé de reversements', '', '', company],
        ['Période', period, '', ''],
        ['Généré le', new Date().toLocaleDateString('fr-FR'), '', ''],
        [],
        ['RÉSUMÉ'],
        ['Total brut encaissé (Genius Pay)', totalGross, 'FCFA', ''],
        ['Frais Genius Pay (1%)',             totalFees,  'FCFA', `${((totalFees / (totalGross || 1)) * 100).toFixed(2)}%`],
        ['Commission TransPro (4%)',          totalComm,  'FCFA', `${((totalComm / (totalGross || 1)) * 100).toFixed(2)}%`],
        ['Montant net reversé',               totalNet,   'FCFA', ''],
        [],
        ['Nb reversements', settlements.length, '', ''],
        ['Nb reversements payés', settlements.filter(s => s.status === 'PAID').length, '', ''],
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      wsSummary['!cols'] = [{ wch: 38 }, { wch: 18 }, { wch: 10 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Résumé');

      // Sheet 2 — Détail
      const headers = ['Période', 'Nbre transactions', 'Total brut (FCFA)', 'Frais Genius Pay (FCFA)', 'Commission (FCFA)', 'Net reversé (FCFA)', 'Statut', 'Réf. virement'];
      const rows = settlements.map(s => [
        periodLabel(s),
        s.itemCount,
        s.totalAmount,
        s.geniusPayFees,
        s.commissions,
        s.netAmount,
        STATUS_LBL[s.status] ?? s.status,
        s.transferRef ?? '',
      ]);
      rows.push(['TOTAL', settlements.reduce((a, s) => a + s.itemCount, 0), totalGross, totalFees, totalComm, totalNet, '', '']);
      const wsDetail = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      wsDetail['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsDetail, 'Détail reversements');

      const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
      return {
        buffer,
        filename: `releve-compagnie-${company.toLowerCase().replace(/\s/g, '-')}-${from}-${to}.xlsx`,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    // ── PDF ──────────────────────────────────────────────────────────────────────
    const cols = [
      { t: 'Période',      w: 72 },
      { t: 'Nb trans.',    w: 52 },
      { t: 'Total brut',   w: 90 },
      { t: 'Frais GP',     w: 76 },
      { t: 'Commission',   w: 76 },
      { t: 'Net reversé',  w: 90 },
      { t: 'Statut',       w: 59 },
    ];

    const buffer = await buildPdf((doc) => {
      let y = pdfHdr(doc, 'RELEVÉ DE REVERSEMENTS', `Période : ${period}`, company);

      y = pdfKpiRow(doc, [
        { label: 'Total brut encaissé', value: fmtXOF(totalGross) },
        { label: 'Frais Genius Pay (1%)', value: fmtXOF(totalFees), sub: `${((totalFees / (totalGross || 1)) * 100).toFixed(1)}% du brut` },
        { label: 'Commission TransPro (4%)', value: fmtXOF(totalComm), sub: `${((totalComm / (totalGross || 1)) * 100).toFixed(1)}% du brut` },
        { label: 'Net reversé', value: fmtXOF(totalNet) },
      ], y + 8);

      y = pdfSection(doc, 'Détail par période', y + 6);
      y = pdfTH(doc, cols, y);

      settlements.forEach((s, i) => {
        if (y > doc.page.height - 80) { doc.addPage(); y = 40; }
        y = pdfTR(doc, [
          periodLabel(s),
          String(s.itemCount),
          fmtXOF(s.totalAmount),
          fmtXOF(s.geniusPayFees),
          fmtXOF(s.commissions),
          fmtXOF(s.netAmount),
          STATUS_LBL[s.status] ?? s.status,
        ], cols, y, i % 2 === 0);
      });

      pdfTotal(doc, [
        'TOTAL',
        String(settlements.reduce((a, s) => a + s.itemCount, 0)),
        fmtXOF(totalGross),
        fmtXOF(totalFees),
        fmtXOF(totalComm),
        fmtXOF(totalNet),
        '',
      ], cols, y);
    });

    return {
      buffer,
      filename: `releve-compagnie-${company.toLowerCase().replace(/\s/g, '-')}-${from}-${to}.pdf`,
      mimetype: 'application/pdf',
    };
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
