import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import dayjs from 'dayjs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDoc = require('pdfkit') as typeof import('pdfkit');

// ─── Constants ──────────────────────────────────────────────────────────────
const BRAND = '#f05a1a';
const DARK = '#1e293b';
const GRAY = '#6b7280';
const LIGHT = '#f8fafc';
const MARGIN = 40;
const CONTENT_W = 515; // A4 595pt − 2×40

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtAmt(n: number): string {
  return `${Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}

function fmtDate(d: Date | string, fmt = 'DD/MM/YYYY'): string {
  return dayjs(d).format(fmt);
}

function frenchFull(d: dayjs.Dayjs): string {
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MONTHS = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ];
  return `${DAYS[d.day()]} ${d.date()} ${MONTHS[d.month()]} ${d.year()}`;
}

function frenchShort(d: dayjs.Dayjs): string {
  const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const MONTHS = [
    'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
    'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
  ];
  return `${DAYS[d.day()]} ${d.date()} ${MONTHS[d.month()]}`;
}

function buildCsv(headers: string[], rows: string[][]): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  return [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
}

// ─── PDF drawing helpers ─────────────────────────────────────────────────────
function pdfHeader(doc: any, company: string, title: string, period: string): number {
  doc.fillColor(BRAND).rect(MARGIN, 30, CONTENT_W, 3).fill();

  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15)
    .text(company, MARGIN, 44, { width: 260, lineBreak: false });

  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12)
    .text(title, MARGIN + 255, 46, { width: 260, align: 'right', lineBreak: false });

  doc.fillColor(GRAY).font('Helvetica').fontSize(9)
    .text(period, MARGIN, 67, { width: 300, lineBreak: false })
    .text(
      `Généré le ${fmtDate(new Date(), 'DD/MM/YYYY')} à ${fmtDate(new Date(), 'HH:mm')}`,
      MARGIN + 255, 67, { width: 260, align: 'right', lineBreak: false },
    );

  doc.moveTo(MARGIN, 83).lineTo(MARGIN + CONTENT_W, 83)
    .strokeColor('#e2e8f0').lineWidth(1).stroke();

  return 96;
}

function pdfKpis(
  doc: any,
  kpis: { label: string; value: string; sub?: string }[],
  y: number,
): number {
  const n = kpis.length;
  const gap = 8;
  const boxW = Math.floor((CONTENT_W - gap * (n - 1)) / n);
  const boxH = 52;

  kpis.forEach((k, i) => {
    const x = MARGIN + i * (boxW + gap);
    doc.fillColor('#f1f5f9').roundedRect(x, y, boxW, boxH, 6).fill();
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(13)
      .text(k.value, x + 10, y + 9, { width: boxW - 20, lineBreak: false });
    doc.fillColor(GRAY).font('Helvetica').fontSize(8)
      .text(k.label, x + 10, y + 27, { width: boxW - 20, lineBreak: false });
    if (k.sub) {
      doc.fillColor(BRAND).font('Helvetica').fontSize(7)
        .text(k.sub, x + 10, y + 39, { width: boxW - 20, lineBreak: false });
    }
  });

  return y + boxH + 14;
}

function pdfTableHead(doc: any, cols: { text: string; width: number }[], y: number): number {
  const rowH = 22;
  doc.fillColor(DARK).rect(MARGIN, y, CONTENT_W, rowH).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);

  let x = MARGIN;
  for (const col of cols) {
    doc.text(col.text.toUpperCase(), x + 6, y + 7, { width: col.width - 12, lineBreak: false });
    x += col.width;
  }
  return y + rowH;
}

function pdfTableRow(
  doc: any,
  cells: string[],
  cols: { text: string; width: number }[],
  y: number,
  even: boolean,
): number {
  const rowH = 19;
  if (even) doc.fillColor(LIGHT).rect(MARGIN, y, CONTENT_W, rowH).fill();
  doc.fillColor('#374151').font('Helvetica').fontSize(8);

  let x = MARGIN;
  for (let i = 0; i < cols.length; i++) {
    doc.text(cells[i] ?? '', x + 6, y + 5, { width: cols[i].width - 12, lineBreak: false, ellipsis: true });
    x += cols[i].width;
  }
  doc.moveTo(MARGIN, y + rowH - 0.5)
    .lineTo(MARGIN + CONTENT_W, y + rowH - 0.5)
    .strokeColor('#f1f5f9').lineWidth(0.5).stroke();

  return y + rowH;
}

function pdfTotalRow(doc: any, cells: string[], cols: { text: string; width: number }[], y: number): number {
  const rowH = 22;
  doc.fillColor(DARK).rect(MARGIN, y, CONTENT_W, rowH).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);

  let x = MARGIN;
  for (let i = 0; i < cols.length; i++) {
    doc.text(cells[i] ?? '', x + 6, y + 6, { width: cols[i].width - 12, lineBreak: false });
    x += cols[i].width;
  }
  return y + rowH;
}

function pdfFooter(doc: any) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fillColor(GRAY).font('Helvetica').fontSize(8).text(
      `TransPro CI  ·  Page ${i + 1} / ${range.count}`,
      MARGIN,
      doc.page.height - 28,
      { width: CONTENT_W, align: 'center', lineBreak: false },
    );
  }
}

async function buildPdf(buildFn: (doc: any) => void): Promise<Buffer> {
  const doc = new PDFDoc({ margin: MARGIN, bufferPages: true, size: 'A4' });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  buildFn(doc);
  pdfFooter(doc);
  doc.end();
  return done;
}

// ─── Labels ─────────────────────────────────────────────────────────────────
const METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces', GENIUS_PAY: 'Genius Pay',
  ORANGE_MONEY: 'Orange Money', MTN_MOMO: 'MTN MoMo', WAVE: 'Wave',
};
const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmée', PENDING: 'En attente',
  CANCELLED: 'Annulée', COMPLETED: 'Terminée',
};

// ─── Service ─────────────────────────────────────────────────────────────────
export interface ReportOutput {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ── Daily Sales ────────────────────────────────────────────────────────────
  async dailySales(tenantId: string, dateStr: string, format: 'pdf' | 'csv'): Promise<ReportOutput> {
    const date = dayjs(dateStr).isValid() ? dayjs(dateStr) : dayjs();
    const start = date.startOf('day').toDate();
    const end = date.endOf('day').toDate();

    const [tenant, bookings] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, sigle: true } }),
      this.prisma.booking.findMany({
        where: { tenantId, createdAt: { gte: start, lte: end } },
        include: {
          passenger: { select: { firstName: true, lastName: true, phone: true } },
          trip: { select: { departureAt: true, route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } } },
          payment: { select: { method: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const company = (tenant as any)?.sigle ?? tenant?.name ?? 'TransPro CI';
    const confirmed = bookings.filter(b => b.status === 'CONFIRMED' || b.status === 'COMPLETED');
    const cancelled = bookings.filter(b => b.status === 'CANCELLED');
    const totalRevenue = confirmed.reduce((s, b) => s + b.totalAmount, 0);

    const cols = [
      { text: 'Référence',  width: 82 },
      { text: 'Passager',   width: 103 },
      { text: 'Trajet',     width: 110 },
      { text: 'Départ',     width: 62 },
      { text: 'Montant',    width: 73 },
      { text: 'Paiement',   width: 55 },
      { text: 'Statut',     width: 30 },
    ];

    const rows = bookings.map(b => [
      b.reference,
      `${b.passenger.firstName} ${b.passenger.lastName}`,
      `${(b.trip?.route?.originCity as any)?.name ?? ''} → ${(b.trip?.route?.destinationCity as any)?.name ?? ''}`,
      b.trip?.departureAt ? fmtDate(b.trip.departureAt, 'HH:mm') : '-',
      fmtAmt(b.totalAmount),
      b.payment ? (METHOD_LABELS[b.payment.method] ?? b.payment.method) : 'Espèces',
      STATUS_LABELS[b.status] ?? b.status,
    ]);

    if (format === 'csv') {
      const csvHeaders = ['Référence', 'Passager', 'Téléphone', 'Trajet', 'Heure départ', 'Sièges', 'Montant', 'Paiement', 'Statut', 'Heure résa'];
      const csvRows = bookings.map(b => [
        b.reference,
        `${b.passenger.firstName} ${b.passenger.lastName}`,
        b.passenger.phone ?? '',
        `${(b.trip?.route?.originCity as any)?.name ?? ''} → ${(b.trip?.route?.destinationCity as any)?.name ?? ''}`,
        b.trip?.departureAt ? fmtDate(b.trip.departureAt, 'HH:mm') : '-',
        b.seatNumbers.join(', '),
        b.totalAmount.toString(),
        b.payment ? (METHOD_LABELS[b.payment.method] ?? b.payment.method) : 'Espèces',
        STATUS_LABELS[b.status] ?? b.status,
        fmtDate(b.createdAt, 'HH:mm'),
      ]);
      return {
        buffer: Buffer.from('﻿' + buildCsv(csvHeaders, csvRows), 'utf8'),
        filename: `ventes-${date.format('YYYY-MM-DD')}.csv`,
        mimetype: 'text/csv; charset=utf-8',
      };
    }

    const buffer = await buildPdf((doc) => {
      let y = pdfHeader(doc, company, 'Ventes journalières', frenchFull(date));

      y = pdfKpis(doc, [
        { label: "Chiffre d'affaires", value: fmtAmt(totalRevenue) },
        {
          label: 'Réservations',
          value: bookings.length.toString(),
          sub: `${confirmed.length} confirmées · ${cancelled.length} annulées`,
        },
        {
          label: 'Montant moyen',
          value: confirmed.length > 0 ? fmtAmt(totalRevenue / confirmed.length) : '0 FCFA',
        },
      ], y);

      y = pdfTableHead(doc, cols, y);
      rows.forEach((row, i) => {
        if (y > doc.page.height - 70) {
          doc.addPage();
          y = pdfTableHead(doc, cols, 40);
        }
        y = pdfTableRow(doc, row, cols, y, i % 2 === 0);
      });
    });

    return { buffer, filename: `ventes-${date.format('YYYY-MM-DD')}.pdf`, mimetype: 'application/pdf' };
  }

  // ── Weekly Summary ─────────────────────────────────────────────────────────
  async weeklySummary(tenantId: string, weekStartStr: string, format: 'pdf' | 'csv'): Promise<ReportOutput> {
    const weekStart = (dayjs(weekStartStr).isValid() ? dayjs(weekStartStr) : dayjs()).startOf('day');
    const weekEnd = weekStart.add(6, 'day').endOf('day');

    const [tenant, payments, bookings] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, sigle: true } }),
      this.prisma.payment.findMany({
        where: { tenantId, status: 'SUCCESS', paidAt: { gte: weekStart.toDate(), lte: weekEnd.toDate() } },
        select: { amount: true, paidAt: true },
      }),
      this.prisma.booking.findMany({
        where: { tenantId, createdAt: { gte: weekStart.toDate(), lte: weekEnd.toDate() } },
        select: { createdAt: true, status: true, totalAmount: true },
      }),
    ]);

    const company = (tenant as any)?.sigle ?? tenant?.name ?? 'TransPro CI';

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = weekStart.add(i, 'day');
      const ds = d.startOf('day').toDate();
      const de = d.endOf('day').toDate();
      const rev = payments.filter(p => p.paidAt && p.paidAt >= ds && p.paidAt <= de).reduce((s, p) => s + p.amount, 0);
      const bks = bookings.filter(b => b.createdAt >= ds && b.createdAt <= de);
      return {
        label: frenchShort(d),
        revenue: rev,
        total: bks.length,
        confirmed: bks.filter(b => b.status === 'CONFIRMED' || b.status === 'COMPLETED').length,
        cancelled: bks.filter(b => b.status === 'CANCELLED').length,
      };
    });

    const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
    const totalConfirmed = bookings.filter(b => b.status === 'CONFIRMED' || b.status === 'COMPLETED').length;
    const totalCancelled = bookings.filter(b => b.status === 'CANCELLED').length;

    const cols = [
      { text: 'Jour',           width: 130 },
      { text: 'Réservations',   width: 95 },
      { text: 'Confirmées',     width: 95 },
      { text: 'Annulées',       width: 95 },
      { text: 'Revenus',        width: 100 },
    ];

    if (format === 'csv') {
      const csvHeaders = ['Jour', 'Réservations', 'Confirmées', 'Annulées', 'Revenus (FCFA)'];
      const csvRows = days.map(d => [d.label, d.total.toString(), d.confirmed.toString(), d.cancelled.toString(), d.revenue.toString()]);
      csvRows.push(['TOTAL', bookings.length.toString(), totalConfirmed.toString(), totalCancelled.toString(), totalRevenue.toString()]);
      return {
        buffer: Buffer.from('﻿' + buildCsv(csvHeaders, csvRows), 'utf8'),
        filename: `bilan-${weekStart.format('YYYY-MM-DD')}.csv`,
        mimetype: 'text/csv; charset=utf-8',
      };
    }

    const buffer = await buildPdf((doc) => {
      let y = pdfHeader(
        doc, company, 'Bilan hebdomadaire',
        `${frenchShort(weekStart)} – ${frenchShort(weekEnd)}  ${weekEnd.year()}`,
      );

      y = pdfKpis(doc, [
        { label: "Chiffre d'affaires", value: fmtAmt(totalRevenue) },
        { label: 'Réservations totales', value: bookings.length.toString() },
        { label: 'Confirmées', value: totalConfirmed.toString() },
        { label: 'Annulées', value: totalCancelled.toString() },
      ], y);

      y = pdfTableHead(doc, cols, y);
      days.forEach((d, i) => {
        y = pdfTableRow(doc, [d.label, d.total.toString(), d.confirmed.toString(), d.cancelled.toString(), fmtAmt(d.revenue)], cols, y, i % 2 === 0);
      });

      y = pdfTotalRow(doc, ['TOTAL', bookings.length.toString(), totalConfirmed.toString(), totalCancelled.toString(), fmtAmt(totalRevenue)], cols, y + 4);
    });

    return { buffer, filename: `bilan-${weekStart.format('YYYY-MM-DD')}.pdf`, mimetype: 'application/pdf' };
  }

  // ── Trip Report ────────────────────────────────────────────────────────────
  async tripReport(tenantId: string, tripId: string, format: 'pdf' | 'csv'): Promise<ReportOutput> {
    const [tenant, trip] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, sigle: true } }),
      this.prisma.trip.findUnique({
        where: { id: tripId },
        include: {
          route: true,
          vehicle: true,
          driver: true,
          bookings: {
            where: { status: { not: 'CANCELLED' } },
            include: {
              passenger: { select: { firstName: true, lastName: true, phone: true } },
              payment: { select: { method: true } },
            },
          },
        },
      }),
    ]);

    if (!trip || trip.tenantId !== tenantId) throw new NotFoundException('Voyage introuvable');

    const company = (tenant as any)?.sigle ?? tenant?.name ?? 'TransPro CI';

    type SeatRow = { seat: string; name: string; phone: string; ref: string; amount: number; method: string };
    const seatRows: SeatRow[] = trip.bookings
      .flatMap(b =>
        b.seatNumbers.map(seat => ({
          seat,
          name: `${b.passenger.firstName} ${b.passenger.lastName}`,
          phone: b.passenger.phone ?? '-',
          ref: b.reference,
          amount: Math.round(b.totalAmount / b.seatNumbers.length),
          method: b.payment ? (METHOD_LABELS[b.payment.method] ?? b.payment.method) : 'Espèces',
        })),
      )
      .sort((a, b) => a.seat.localeCompare(b.seat, undefined, { numeric: true }));

    const totalRevenue = trip.bookings.reduce((s, b) => s + b.totalAmount, 0);
    const occupied = trip.totalSeats - trip.availableSeats;
    const occupancy = trip.totalSeats > 0 ? Math.round((occupied / trip.totalSeats) * 100) : 0;
    const safeName = trip.route.name.replace(/[\s/\\]+/g, '-');

    const cols = [
      { text: 'Siège',     width: 45 },
      { text: 'Passager',  width: 135 },
      { text: 'Téléphone', width: 90 },
      { text: 'Référence', width: 90 },
      { text: 'Montant',   width: 75 },
      { text: 'Paiement',  width: 80 },
    ];

    if (format === 'csv') {
      const csvHeaders = ['Siège', 'Passager', 'Téléphone', 'Référence', 'Montant (FCFA)', 'Paiement'];
      const csvRows = seatRows.map(r => [r.seat, r.name, r.phone, r.ref, r.amount.toString(), r.method]);
      return {
        buffer: Buffer.from('﻿' + buildCsv(csvHeaders, csvRows), 'utf8'),
        filename: `voyage-${safeName}-${fmtDate(trip.departureAt, 'YYYY-MM-DD')}.csv`,
        mimetype: 'text/csv; charset=utf-8',
      };
    }

    const buffer = await buildPdf((doc) => {
      const dep = dayjs(trip.departureAt);
      let y = pdfHeader(
        doc, company, 'Rapport de voyage',
        `${(trip.route as any).originCity?.name ?? ''} → ${(trip.route as any).destinationCity?.name ?? ''}  ·  ${frenchFull(dep)} à ${dep.format('HH:mm')}`,
      );

      // Trip info strip
      doc.fillColor('#f1f5f9').rect(MARGIN, y, CONTENT_W, 46).fill();
      const infos = [
        { label: 'Véhicule',     value: trip.vehicle?.plate ?? '-' },
        { label: 'Chauffeur',    value: trip.driver ? `${trip.driver.firstName} ${trip.driver.lastName}` : '-' },
        { label: 'Statut',       value: trip.status },
        { label: 'Places totales', value: trip.totalSeats.toString() },
      ];
      const infoW = Math.floor(CONTENT_W / 4);
      infos.forEach((info, i) => {
        const x = MARGIN + i * infoW + 10;
        doc.fillColor(GRAY).font('Helvetica').fontSize(7.5).text(info.label, x, y + 8, { width: infoW - 20, lineBreak: false });
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(info.value, x, y + 20, { width: infoW - 20, lineBreak: false });
      });
      y += 60;

      y = pdfKpis(doc, [
        { label: 'Revenus voyage', value: fmtAmt(totalRevenue) },
        { label: 'Passagers', value: `${occupied} / ${trip.totalSeats}`, sub: `${occupancy}% d'occupation` },
        { label: 'Réservations', value: trip.bookings.length.toString() },
      ], y);

      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
        .text('Manifeste passagers', MARGIN, y, { lineBreak: false });
      y += 16;

      y = pdfTableHead(doc, cols, y);
      seatRows.forEach((r, i) => {
        if (y > doc.page.height - 70) {
          doc.addPage();
          y = pdfTableHead(doc, cols, 40);
        }
        y = pdfTableRow(doc, [r.seat, r.name, r.phone, r.ref, fmtAmt(r.amount), r.method], cols, y, i % 2 === 0);
      });
    });

    return {
      buffer,
      filename: `voyage-${safeName}-${fmtDate(trip.departureAt, 'YYYY-MM-DD')}.pdf`,
      mimetype: 'application/pdf',
    };
  }

  // ── Station Daily Sales ────────────────────────────────────────────────────
  async stationDailySales(stationId: string, tenantId: string, dateStr: string, format: 'pdf' | 'csv'): Promise<ReportOutput> {
    const date = dayjs(dateStr).isValid() ? dayjs(dateStr) : dayjs();
    const start = date.startOf('day').toDate();
    const end = date.endOf('day').toDate();

    const [station, bookings] = await Promise.all([
      this.prisma.station.findFirst({ where: { id: stationId, tenantId }, select: { name: true, city: { select: { name: true } }, code: true } }),
      this.prisma.booking.findMany({
        where: { tenantId, soldByStationId: stationId, createdAt: { gte: start, lte: end } },
        include: {
          passenger: { select: { firstName: true, lastName: true, phone: true } },
          trip: { select: { departureAt: true, route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } } },
          payment: { select: { method: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    if (!station) throw new NotFoundException('Gare introuvable');
    const stationLabel = station.code ? `${station.name} (${station.code})` : station.name;
    const confirmed = bookings.filter(b => b.status === 'CONFIRMED' || b.status === 'COMPLETED');
    const cancelled = bookings.filter(b => b.status === 'CANCELLED');
    const totalRevenue = confirmed.reduce((s, b) => s + b.totalAmount, 0);

    const cols = [
      { text: 'Référence',  width: 82 },
      { text: 'Passager',   width: 103 },
      { text: 'Trajet',     width: 110 },
      { text: 'Départ',     width: 62 },
      { text: 'Montant',    width: 73 },
      { text: 'Paiement',   width: 55 },
      { text: 'Statut',     width: 30 },
    ];

    const rows = bookings.map(b => [
      b.reference,
      `${b.passenger.firstName} ${b.passenger.lastName}`,
      `${(b.trip?.route?.originCity as any)?.name ?? ''} → ${(b.trip?.route?.destinationCity as any)?.name ?? ''}`,
      b.trip?.departureAt ? fmtDate(b.trip.departureAt, 'HH:mm') : '-',
      fmtAmt(b.totalAmount),
      b.payment ? (METHOD_LABELS[b.payment.method] ?? b.payment.method) : 'Espèces',
      STATUS_LABELS[b.status] ?? b.status,
    ]);

    if (format === 'csv') {
      const csvHeaders = ['Référence', 'Passager', 'Téléphone', 'Trajet', 'Heure départ', 'Sièges', 'Montant', 'Paiement', 'Statut', 'Heure résa'];
      const csvRows = bookings.map(b => [
        b.reference,
        `${b.passenger.firstName} ${b.passenger.lastName}`,
        b.passenger.phone ?? '',
        `${(b.trip?.route?.originCity as any)?.name ?? ''} → ${(b.trip?.route?.destinationCity as any)?.name ?? ''}`,
        b.trip?.departureAt ? fmtDate(b.trip.departureAt, 'HH:mm') : '-',
        b.seatNumbers.join(', '),
        b.totalAmount.toString(),
        b.payment ? (METHOD_LABELS[b.payment.method] ?? b.payment.method) : 'Espèces',
        STATUS_LABELS[b.status] ?? b.status,
        fmtDate(b.createdAt, 'HH:mm'),
      ]);
      return {
        buffer: Buffer.from('﻿' + buildCsv(csvHeaders, csvRows), 'utf8'),
        filename: `gare-ventes-${date.format('YYYY-MM-DD')}.csv`,
        mimetype: 'text/csv; charset=utf-8',
      };
    }

    const buffer = await buildPdf((doc) => {
      let y = pdfHeader(doc, stationLabel, 'Ventes journalières', frenchFull(date));
      y = pdfKpis(doc, [
        { label: "Chiffre d'affaires", value: fmtAmt(totalRevenue) },
        { label: 'Billets vendus', value: bookings.length.toString(), sub: `${confirmed.length} confirmés · ${cancelled.length} annulés` },
        { label: 'Montant moyen', value: confirmed.length > 0 ? fmtAmt(totalRevenue / confirmed.length) : '0 FCFA' },
      ], y);
      y = pdfTableHead(doc, cols, y);
      rows.forEach((row, i) => {
        if (y > doc.page.height - 70) { doc.addPage(); y = pdfTableHead(doc, cols, 40); }
        y = pdfTableRow(doc, row, cols, y, i % 2 === 0);
      });
    });

    return { buffer, filename: `gare-ventes-${date.format('YYYY-MM-DD')}.pdf`, mimetype: 'application/pdf' };
  }

  // ── Station Weekly Summary ─────────────────────────────────────────────────
  async stationWeeklySummary(stationId: string, tenantId: string, weekStartStr: string, format: 'pdf' | 'csv'): Promise<ReportOutput> {
    const weekStart = (dayjs(weekStartStr).isValid() ? dayjs(weekStartStr) : dayjs()).startOf('day');
    const weekEnd = weekStart.add(6, 'day').endOf('day');

    const [station, payments, bookings] = await Promise.all([
      this.prisma.station.findFirst({ where: { id: stationId, tenantId }, select: { name: true, city: { select: { name: true } }, code: true } }),
      this.prisma.payment.findMany({
        where: {
          tenantId, status: 'SUCCESS',
          paidAt: { gte: weekStart.toDate(), lte: weekEnd.toDate() },
          booking: { soldByStationId: stationId },
        },
        select: { amount: true, paidAt: true, method: true },
      }),
      this.prisma.booking.findMany({
        where: { tenantId, soldByStationId: stationId, createdAt: { gte: weekStart.toDate(), lte: weekEnd.toDate() } },
        select: { createdAt: true, status: true, totalAmount: true },
      }),
    ]);

    if (!station) throw new NotFoundException('Gare introuvable');
    const stationLabel = station.code ? `${station.name} (${station.code})` : station.name;

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = weekStart.add(i, 'day');
      const ds = d.startOf('day').toDate();
      const de = d.endOf('day').toDate();
      const rev = payments.filter(p => p.paidAt && p.paidAt >= ds && p.paidAt <= de).reduce((s, p) => s + p.amount, 0);
      const bks = bookings.filter(b => b.createdAt >= ds && b.createdAt <= de);
      return {
        label: frenchShort(d),
        revenue: rev,
        total: bks.length,
        confirmed: bks.filter(b => b.status === 'CONFIRMED' || b.status === 'COMPLETED').length,
        cancelled: bks.filter(b => b.status === 'CANCELLED').length,
      };
    });

    const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
    const totalConfirmed = bookings.filter(b => b.status === 'CONFIRMED' || b.status === 'COMPLETED').length;
    const totalCancelled = bookings.filter(b => b.status === 'CANCELLED').length;

    const byMethod: Record<string, number> = {};
    for (const p of payments) {
      byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    }

    const cols = [
      { text: 'Jour',         width: 130 },
      { text: 'Billets',      width: 95 },
      { text: 'Confirmés',    width: 95 },
      { text: 'Annulés',      width: 95 },
      { text: 'Revenus',      width: 100 },
    ];

    if (format === 'csv') {
      const csvHeaders = ['Jour', 'Billets', 'Confirmés', 'Annulés', 'Revenus (FCFA)'];
      const csvRows = days.map(d => [d.label, d.total.toString(), d.confirmed.toString(), d.cancelled.toString(), d.revenue.toString()]);
      csvRows.push(['TOTAL', bookings.length.toString(), totalConfirmed.toString(), totalCancelled.toString(), totalRevenue.toString()]);
      return {
        buffer: Buffer.from('﻿' + buildCsv(csvHeaders, csvRows), 'utf8'),
        filename: `gare-bilan-${weekStart.format('YYYY-MM-DD')}.csv`,
        mimetype: 'text/csv; charset=utf-8',
      };
    }

    const buffer = await buildPdf((doc) => {
      let y = pdfHeader(doc, stationLabel, 'Bilan hebdomadaire', `${frenchShort(weekStart)} – ${frenchShort(weekEnd)}  ${weekEnd.year()}`);
      y = pdfKpis(doc, [
        { label: "Chiffre d'affaires", value: fmtAmt(totalRevenue) },
        { label: 'Billets vendus', value: bookings.length.toString() },
        { label: 'Confirmés', value: totalConfirmed.toString() },
        { label: 'Annulés', value: totalCancelled.toString() },
      ], y);

      y = pdfTableHead(doc, cols, y);
      days.forEach((d, i) => {
        y = pdfTableRow(doc, [d.label, d.total.toString(), d.confirmed.toString(), d.cancelled.toString(), fmtAmt(d.revenue)], cols, y, i % 2 === 0);
      });
      pdfTotalRow(doc, ['TOTAL', bookings.length.toString(), totalConfirmed.toString(), totalCancelled.toString(), fmtAmt(totalRevenue)], cols, y + 4);

      // Breakdown par mode de paiement
      if (Object.keys(byMethod).length > 0) {
        let by = y + 40;
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text('Répartition par mode de paiement', MARGIN, by);
        by += 16;
        const mCols = [{ text: 'Mode', width: 200 }, { text: 'Montant', width: 150 }, { text: '% du total', width: 165 }];
        by = pdfTableHead(doc, mCols, by);
        Object.entries(byMethod).forEach(([method, amount], i) => {
          const pct = totalRevenue > 0 ? ((amount / totalRevenue) * 100).toFixed(1) : '0';
          by = pdfTableRow(doc, [METHOD_LABELS[method] ?? method, fmtAmt(amount), `${pct} %`], mCols, by, i % 2 === 0);
        });
      }
    });

    return { buffer, filename: `gare-bilan-${weekStart.format('YYYY-MM-DD')}.pdf`, mimetype: 'application/pdf' };
  }

  // ── Station Trip Report ────────────────────────────────────────────────────
  async stationTripReport(stationId: string, tenantId: string, tripId: string, format: 'pdf' | 'csv'): Promise<ReportOutput> {
    const [station, trip] = await Promise.all([
      this.prisma.station.findFirst({ where: { id: stationId, tenantId }, select: { name: true, code: true } }),
      this.prisma.trip.findUnique({
        where: { id: tripId },
        include: {
          route: true,
          vehicle: true,
          driver: true,
          bookings: {
            where: { status: { not: 'CANCELLED' } },
            include: {
              passenger: { select: { firstName: true, lastName: true, phone: true } },
              payment: { select: { method: true } },
            },
          },
        },
      }),
    ]);

    if (!station) throw new NotFoundException('Gare introuvable');
    if (!trip || trip.tenantId !== tenantId) throw new NotFoundException('Voyage introuvable');

    const stationLabel = station.code ? `${station.name} (${station.code})` : station.name;

    type SeatRow = { seat: string; name: string; phone: string; ref: string; amount: number; method: string };
    const seatRows: SeatRow[] = trip.bookings
      .flatMap(b =>
        b.seatNumbers.map(seat => ({
          seat,
          name: `${b.passenger.firstName} ${b.passenger.lastName}`,
          phone: b.passenger.phone ?? '-',
          ref: b.reference,
          amount: Math.round(b.totalAmount / b.seatNumbers.length),
          method: b.payment ? (METHOD_LABELS[b.payment.method] ?? b.payment.method) : 'Espèces',
        })),
      )
      .sort((a, b) => a.seat.localeCompare(b.seat, undefined, { numeric: true }));

    const totalRevenue = trip.bookings.reduce((s, b) => s + b.totalAmount, 0);
    const occupied = trip.totalSeats - trip.availableSeats;
    const occupancy = trip.totalSeats > 0 ? Math.round((occupied / trip.totalSeats) * 100) : 0;
    const safeName = trip.route.name.replace(/[\s/\\]+/g, '-');

    const cols = [
      { text: 'Siège',     width: 45 },
      { text: 'Passager',  width: 135 },
      { text: 'Téléphone', width: 90 },
      { text: 'Référence', width: 90 },
      { text: 'Montant',   width: 75 },
      { text: 'Paiement',  width: 80 },
    ];

    if (format === 'csv') {
      const csvHeaders = ['Siège', 'Passager', 'Téléphone', 'Référence', 'Montant (FCFA)', 'Paiement'];
      const csvRows = seatRows.map(r => [r.seat, r.name, r.phone, r.ref, r.amount.toString(), r.method]);
      return {
        buffer: Buffer.from('﻿' + buildCsv(csvHeaders, csvRows), 'utf8'),
        filename: `gare-voyage-${safeName}-${fmtDate(trip.departureAt, 'YYYY-MM-DD')}.csv`,
        mimetype: 'text/csv; charset=utf-8',
      };
    }

    const buffer = await buildPdf((doc) => {
      const dep = dayjs(trip.departureAt);
      let y = pdfHeader(
        doc, stationLabel, 'Manifeste de voyage',
        `${(trip.route as any).originCity?.name ?? ''} → ${(trip.route as any).destinationCity?.name ?? ''}  ·  ${frenchFull(dep)} à ${dep.format('HH:mm')}`,
      );

      doc.fillColor('#f1f5f9').rect(MARGIN, y, CONTENT_W, 46).fill();
      const infos = [
        { label: 'Véhicule',  value: trip.vehicle?.plate ?? '-' },
        { label: 'Chauffeur', value: trip.driver ? `${trip.driver.firstName} ${trip.driver.lastName}` : '-' },
        { label: 'Statut',    value: trip.status },
        { label: 'Occupation', value: `${occupied}/${trip.totalSeats} (${occupancy}%)` },
      ];
      const infoW = Math.floor(CONTENT_W / 4);
      infos.forEach((info, i) => {
        const x = MARGIN + i * infoW + 10;
        doc.fillColor(GRAY).font('Helvetica').fontSize(7.5).text(info.label, x, y + 8, { width: infoW - 20, lineBreak: false });
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(info.value, x, y + 20, { width: infoW - 20, lineBreak: false });
      });
      y += 60;

      y = pdfKpis(doc, [
        { label: 'Revenus voyage', value: fmtAmt(totalRevenue) },
        { label: 'Passagers embarqués', value: `${occupied} / ${trip.totalSeats}`, sub: `${occupancy}% d'occupation` },
        { label: 'Réservations actives', value: trip.bookings.length.toString() },
      ], y);

      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text('Liste des passagers', MARGIN, y);
      y += 16;
      y = pdfTableHead(doc, cols, y);
      seatRows.forEach((r, i) => {
        if (y > doc.page.height - 70) { doc.addPage(); y = pdfTableHead(doc, cols, 40); }
        y = pdfTableRow(doc, [r.seat, r.name, r.phone, r.ref, fmtAmt(r.amount), r.method], cols, y, i % 2 === 0);
      });
    });

    return {
      buffer,
      filename: `gare-voyage-${safeName}-${fmtDate(trip.departureAt, 'YYYY-MM-DD')}.pdf`,
      mimetype: 'application/pdf',
    };
  }
}
