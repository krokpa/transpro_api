// ── PDF Branding Helper ──────────────────────────────────────────────────────
// Applies company logo to PDF documents: header band and/or semi-transparent watermark.

export interface DocumentBrandingSettings {
  logoPosition: 'none' | 'header' | 'watermark' | 'both';
  watermarkOpacity: number;   // 0.03 – 0.30; default 0.07
  footerText?: string;        // custom label replacing "TransPro CI" in footer
}

export function extractBranding(settings: unknown): DocumentBrandingSettings {
  const b = (settings as any)?.documentBranding ?? {};
  return {
    logoPosition: (['none', 'header', 'watermark', 'both'] as const).includes(b.logoPosition)
      ? b.logoPosition : 'none',
    watermarkOpacity: typeof b.watermarkOpacity === 'number'
      ? Math.max(0.03, Math.min(0.30, b.watermarkOpacity)) : 0.07,
    footerText: typeof b.footerText === 'string' && b.footerText.trim()
      ? b.footerText.trim() : undefined,
  };
}

/** Convert a base64 data-URL logo to a Buffer for PDFKit. Returns null for URLs. */
export function parseLogo(logo: string | null | undefined): Buffer | null {
  if (!logo) return null;
  const m = logo.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
  if (!m) return null;
  return Buffer.from(m[2], 'base64');
}

/** Draw logo in the header band starting at (40, y). Returns extra x-offset for text. */
export function drawHeaderLogo(doc: any, logoBuffer: Buffer, y = 32): number {
  try {
    doc.image(logoBuffer, 40, y, { fit: [44, 44] });
    return 54; // 44px logo + 10px gap
  } catch {
    return 0;
  }
}

/** Draw semi-transparent watermark centered on the current page (call during page sweep). */
export function applyWatermark(doc: any, logoBuffer: Buffer, opacity: number): void {
  const size = 200;
  const x = (doc.page.width  - size) / 2;
  const y = (doc.page.height - size) / 2;
  try {
    doc.save();
    doc.opacity(opacity);
    doc.image(logoBuffer, x, y, { fit: [size, size] });
    doc.restore();
  } catch {
    // skip unsupported formats (e.g. SVG) or corrupt data
  }
}
