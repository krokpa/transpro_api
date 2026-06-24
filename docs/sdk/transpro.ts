/**
 * TransPro — SDK officiel de l'API Partenaires (TypeScript / JavaScript).
 * Sans dépendance (utilise `fetch`, Node 18+ ou navigateur côté serveur).
 *
 * Usage:
 *   import { TransProClient } from './transpro';
 *   const client = new TransProClient({ apiKey: 'tpk_live_…' });
 *   const trips = await client.searchTrips({ origin: 'Abidjan', destination: 'Bouaké', date: '2026-07-01' });
 */

export interface TransProOptions {
  apiKey: string;
  /** Base URL de l'API, défaut: https://api.transpro.ci/api/v1 */
  baseUrl?: string;
  /** Timeout par requête (ms), défaut 15000. */
  timeoutMs?: number;
}

export interface RateLimit {
  limit: string | null;
  remaining: string | null;
  reset: string | null;
  environment: string | null;
}

export class TransProError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'TransProError';
  }
}

export interface Paginated {
  limit?: number;
  offset?: number;
}

export class TransProClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  /** En-têtes de quota de la dernière réponse. */
  lastRateLimit: RateLimit | null = null;

  constructor(opts: TransProOptions) {
    if (!opts.apiKey) throw new Error('apiKey requis');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.transpro.ci/api/v1').replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  private async request<T>(method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    this.lastRateLimit = {
      limit: res.headers.get('X-RateLimit-Limit'),
      remaining: res.headers.get('X-RateLimit-Remaining'),
      reset: res.headers.get('X-RateLimit-Reset'),
      environment: res.headers.get('X-TransPro-Environment'),
    };

    const json = await res.json().catch(() => null) as any;
    if (!res.ok) {
      const msg = json?.message ?? json?.error ?? `HTTP ${res.status}`;
      throw new TransProError(res.status, msg, json);
    }
    // L'API enveloppe les réponses dans { success, data }.
    return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
  }

  // ── Voyages ────────────────────────────────────────────────────────────────
  searchTrips(p: { origin: string; destination: string; date: string; passengers?: number } & Paginated) {
    return this.request<any[]>('GET', '/ext/trips', { query: p });
  }
  getTrip(id: string) {
    return this.request<any>('GET', `/ext/trips/${encodeURIComponent(id)}`);
  }

  // ── Gares & itinéraires ──────────────────────────────────────────────────────
  listStations(p: Paginated = {}) {
    return this.request<any[]>('GET', '/ext/stations', { query: p });
  }
  listRoutes(p: Paginated = {}) {
    return this.request<any[]>('GET', '/ext/routes', { query: p });
  }

  // ── Réservations ─────────────────────────────────────────────────────────────
  createBooking(
    body: { tripId: string; passengerName: string; passengerPhone: string; passengerEmail?: string; seatNumbers: string[] },
    opts: { idempotencyKey?: string } = {},
  ) {
    return this.request<any>('POST', '/ext/bookings', { body, idempotencyKey: opts.idempotencyKey });
  }
  getBooking(reference: string) {
    return this.request<any>('GET', `/ext/bookings/${encodeURIComponent(reference)}`);
  }

  // ── Colis ────────────────────────────────────────────────────────────────────
  trackParcel(code: string) {
    return this.request<any>('GET', `/ext/parcels/${encodeURIComponent(code)}`);
  }

  // ── Méta / Sandbox ───────────────────────────────────────────────────────────
  me() {
    return this.request<any>('GET', '/ext/me');
  }
  triggerTestWebhook(event?: string) {
    return this.request<any>('POST', '/ext/test/trigger-webhook', { body: { event } });
  }
}

/**
 * Vérifie la signature HMAC d'un webhook reçu.
 * @param secret  Votre webhookSecret (whsec_…)
 * @param headers Les en-têtes reçus (X-TransPro-Timestamp, X-TransPro-Signature)
 * @param rawBody Le corps BRUT de la requête (string, non re-sérialisé)
 */
export async function verifyWebhookSignature(
  secret: string,
  headers: { timestamp: string; signature: string },
  rawBody: string,
): Promise<boolean> {
  // Node crypto si dispo, sinon WebCrypto.
  const sig = headers.signature.replace(/^sha256=/, '');
  const data = `${headers.timestamp}.${rawBody}`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHmac } = await import('crypto');
    const expected = createHmac('sha256', secret).update(data).digest('hex');
    return timingSafeEqualHex(expected, sig);
  } catch {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const buf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    const expected = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return timingSafeEqualHex(expected, sig);
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
