// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDoc = require('pdfkit') as typeof import('pdfkit');

import {
  DocumentBrandingSettings,
  drawHeaderLogo,
  applyWatermark,
} from '../common/pdf-branding.helper';

export interface StatementOutput { buffer: Buffer; filename: string; mimetype: string; }

const M = 40; const CW = 515; const DARK = '#1e293b'; const GR = '#6b7280'; const LT = '#f8fafc';

function fmtXOF(n: number) {
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}
function fmtD(d: Date | string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const CAT_LBL: Record<string, string> = {
  FUEL: 'Carburant', MAINTENANCE: 'Entretien', SALARY: 'Salaires',
  OFFICE: 'Fournitures', CLEANING: 'Nettoyage', SECURITY: 'Sécurité',
  MEAL: 'Restauration', BANKING: 'Frais bancaires', COMMUNICATION: 'Communication',
  TRANSPORT: 'Transport', OTHER: 'Autres',
};

function hdr(doc: any, station: string, title: string, period: string, logoBuffer?: Buffer | null) {
  doc.fillColor('#f05a1a').rect(M, 30, CW, 3).fill();
  const xOff = logoBuffer ? drawHeaderLogo(doc, logoBuffer, 32) : 0;
  const tw = 260 - xOff;
  const nameY = logoBuffer ? 40 : 44;
  const subY  = logoBuffer ? 57 : 67;
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15).text(station, M + xOff, nameY, { width: tw, lineBreak: false });
  doc.fillColor('#f05a1a').font('Helvetica-Bold').fontSize(11).text(title, M + 255, 46, { width: 260, align: 'right', lineBreak: false });
  doc.fillColor(GR).font('Helvetica').fontSize(9).text(period, M + xOff, subY, { width: 300 - xOff, lineBreak: false })
    .text(`Généré le ${fmtD(new Date())}`, M + 255, subY, { width: 260, align: 'right', lineBreak: false });
  doc.moveTo(M, 83).lineTo(M + CW, 83).strokeColor('#e2e8f0').lineWidth(1).stroke();
  return 96;
}
function kpiRow(doc: any, kpis: { label: string; value: string; sub?: string }[], y: number) {
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
function section(doc: any, title: string, y: number) {
  doc.fillColor('#f05a1a').font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), M, y, { width: CW });
  doc.moveTo(M, y + 14).lineTo(M + CW, y + 14).strokeColor('#fed7aa').lineWidth(1).stroke();
  return y + 22;
}
function th(doc: any, cols: { t: string; w: number }[], y: number) {
  doc.fillColor(DARK).rect(M, y, CW, 20).fill();
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7);
  let x = M; for (const c of cols) { doc.text(c.t.toUpperCase(), x + 5, y + 6, { width: c.w - 10, lineBreak: false }); x += c.w; }
  return y + 20;
}
function tr(doc: any, cells: string[], cols: { t: string; w: number }[], y: number, even: boolean) {
  if (even) doc.fillColor(LT).rect(M, y, CW, 18).fill();
  doc.fillColor('#374151').font('Helvetica').fontSize(7.5);
  let x = M; for (let i = 0; i < cols.length; i++) { doc.text(cells[i] ?? '', x + 5, y + 4, { width: cols[i].w - 10, lineBreak: false, ellipsis: true }); x += cols[i].w; }
  doc.moveTo(M, y + 17.5).lineTo(M + CW, y + 17.5).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
  return y + 18;
}
function totalRow(doc: any, cells: string[], cols: { t: string; w: number }[], y: number) {
  doc.fillColor(DARK).rect(M, y, CW, 21).fill();
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
  let x = M; for (let i = 0; i < cols.length; i++) { doc.text(cells[i] ?? '', x + 5, y + 6, { width: cols[i].w - 10, lineBreak: false }); x += cols[i].w; }
  return y + 21;
}

async function buildPdf(
  fn: (doc: any) => void,
  br?: { logo: Buffer | null; settings: DocumentBrandingSettings; appName?: string },
): Promise<Buffer> {
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
    if (br?.logo && (br.settings.logoPosition === 'watermark' || br.settings.logoPosition === 'both')) {
      applyWatermark(doc, br.logo, br.settings.watermarkOpacity);
    }
    const footerLabel = br?.settings.footerText ?? br?.appName ?? 'TransPro CI';
    doc.fillColor(GR).font('Helvetica').fontSize(7.5).text(
      `${footerLabel}  ·  Page ${i + 1} / ${rng.count}`,
      M, doc.page.height - 26, { width: CW, align: 'center', lineBreak: false },
    );
  }
  doc.end();
  return done;
}

export async function buildPdfFromExpenses(params: {
  stationName: string;
  period: string;
  from: string;
  to: string;
  cashSales: number;
  totalExpenses: number;
  totalProvisions: number;
  estimatedBalance: number;
  byCategory: Record<string, number>;
  expenses: any[];
  provisions: any[];
  branding?: { logo: Buffer | null; settings: DocumentBrandingSettings; appName?: string };
}): Promise<Buffer> {
  const { stationName, period, cashSales, totalExpenses, totalProvisions, estimatedBalance, byCategory, expenses, provisions, branding } = params;
  const showHeaderLogo = branding?.logo && (branding.settings.logoPosition === 'header' || branding.settings.logoPosition === 'both');

  return buildPdf((doc) => {
    let y = hdr(doc, stationName, 'RELEVÉ DE CAISSE', `Période : ${period}`, showHeaderLogo ? branding!.logo : null);

    y = kpiRow(doc, [
      { label: 'Ventes espèces', value: fmtXOF(cashSales) },
      { label: 'Approvisionnements reçus', value: fmtXOF(totalProvisions) },
      { label: 'Dépenses approuvées', value: fmtXOF(totalExpenses) },
      { label: 'Solde estimé', value: fmtXOF(estimatedBalance), sub: estimatedBalance >= 0 ? 'Positif' : 'Déficitaire' },
    ], y + 8);

    // Dépenses
    if (expenses.length > 0) {
      y += 8;
      y = section(doc, `Dépenses approuvées (${expenses.length})`, y);
      const cols = [{ t: 'Date', w: 68 }, { t: 'Catégorie', w: 90 }, { t: 'Description', w: 237 }, { t: 'Montant', w: 80 }, { t: 'Approuvé par', w: 80 }];
      y = th(doc, cols, y);
      expenses.forEach((e, i) => {
        if (y > doc.page.height - 80) { doc.addPage(); y = 40; }
        const approver = e.approver ? `${e.approver.firstName} ${e.approver.lastName[0]}.` : '—';
        y = tr(doc, [fmtD(e.date), CAT_LBL[e.category] ?? e.category, e.description, fmtXOF(e.amount), approver], cols, y, i % 2 === 0);
      });
      totalRow(doc, ['TOTAL', '', '', fmtXOF(totalExpenses), ''], cols, y); y += 21;
    }

    // Approvisionnements
    if (provisions.length > 0) {
      y += 10;
      if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
      y = section(doc, `Approvisionnements reçus (${provisions.length})`, y);
      const cols = [{ t: 'Date réception', w: 100 }, { t: 'Motif', w: 295 }, { t: 'Montant', w: 120 }];
      y = th(doc, cols, y);
      provisions.forEach((p, i) => {
        if (y > doc.page.height - 80) { doc.addPage(); y = 40; }
        y = tr(doc, [fmtD(p.receivedAt ?? p.createdAt), p.reason ?? '—', fmtXOF(p.amount)], cols, y, i % 2 === 0);
      });
      totalRow(doc, ['TOTAL', '', fmtXOF(totalProvisions)], cols, y); y += 21;
    }

    // Répartition par catégorie
    const catEntries = Object.entries(byCategory).sort(([, a], [, b]) => b - a);
    if (catEntries.length > 0) {
      y += 10;
      if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
      y = section(doc, 'Répartition des dépenses par catégorie', y);
      const cols = [{ t: 'Catégorie', w: 200 }, { t: 'Montant (FCFA)', w: 150 }, { t: 'Part (%)', w: 80 }, { t: '', w: 85 }];
      y = th(doc, cols, y);
      catEntries.forEach(([cat, amt], i) => {
        const pct = totalExpenses > 0 ? ((amt / totalExpenses) * 100).toFixed(1) : '0.0';
        y = tr(doc, [CAT_LBL[cat] ?? cat, fmtXOF(amt), `${pct}%`, ''], cols, y, i % 2 === 0);
      });
    }
  }, branding);
}
