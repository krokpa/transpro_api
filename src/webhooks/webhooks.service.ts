import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEvent } from '@prisma/client';

const MAX_ATTEMPTS = 6;
// Backoff par numéro de tentative (minutes) : 1m, 5m, 15m, 1h, 6h, 24h.
const BACKOFF_MINUTES = [1, 5, 15, 60, 360, 1440];
const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private prisma: PrismaService) {}

  /** Génère un secret de signature webhook (`whsec_...`). */
  static generateSecret(): string {
    return `whsec_${randomBytes(24).toString('base64url')}`;
  }

  /**
   * Émet un événement vers un consumer API précis (celui qui a créé la ressource).
   * No-op si le consumer n'a pas d'URL webhook ou n'est pas actif.
   */
  async emitToConsumer(
    consumerId: string | null | undefined,
    event: WebhookEvent,
    payload: Record<string, any>,
  ): Promise<void> {
    if (!consumerId) return;
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer || consumer.status !== 'ACTIVE' || !consumer.webhookUrl) return;

    // S'assure qu'un secret de signature existe.
    if (!consumer.webhookSecret) {
      await this.prisma.apiConsumer.update({
        where: { id: consumer.id },
        data: { webhookSecret: WebhooksService.generateSecret() },
      });
    }

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        consumerId: consumer.id,
        event,
        url: consumer.webhookUrl,
        payload,
        status: 'PENDING',
      },
    });

    // Première tentative immédiate (fire-and-forget ; les retries passent par le cron).
    this.attemptDelivery(delivery.id).catch((e) =>
      this.logger.error(`Webhook ${delivery.id} initial attempt failed: ${e?.message}`),
    );
  }

  /** Tente une livraison HTTP signée ; programme un retry en cas d'échec. */
  async attemptDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { consumer: true },
    });
    if (!delivery || delivery.status === 'DELIVERED') return;

    const secret = delivery.consumer.webhookSecret ?? '';
    const attempt = delivery.attempts + 1;

    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      createdAt: delivery.createdAt.toISOString(),
      data: delivery.payload,
    });
    const timestamp = Date.now().toString();
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    let statusCode: number | undefined;
    let errorMsg: string | undefined;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(delivery.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TransPro-Event': delivery.event,
          'X-TransPro-Delivery': delivery.id,
          'X-TransPro-Timestamp': timestamp,
          'X-TransPro-Signature': `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      statusCode = res.status;
      if (!res.ok) errorMsg = `HTTP ${res.status}`;
    } catch (err) {
      errorMsg = (err as Error).message ?? 'network error';
    }

    if (statusCode && statusCode >= 200 && statusCode < 300) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          attempts: attempt,
          statusCode,
          deliveredAt: new Date(),
          nextRetryAt: null,
          lastError: null,
        },
      });
      return;
    }

    // Échec → programmer un retry ou marquer FAILED.
    const exhausted = attempt >= MAX_ATTEMPTS;
    const backoffMin = BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)];
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: exhausted ? 'FAILED' : 'PENDING',
        attempts: attempt,
        statusCode: statusCode ?? null,
        lastError: errorMsg,
        nextRetryAt: exhausted ? null : new Date(Date.now() + backoffMin * 60_000),
      },
    });
    this.logger.warn(
      `Webhook ${delivery.id} attempt ${attempt}/${MAX_ATTEMPTS} failed (${errorMsg})` +
        (exhausted ? ' — gave up' : ` — retry in ${backoffMin}min`),
    );
  }

  /** Reprend les livraisons en attente dont le retry est dû. */
  @Cron(CronExpression.EVERY_MINUTE)
  async retryPending(): Promise<void> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: 'PENDING',
        nextRetryAt: { not: null, lte: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      select: { id: true },
      take: 50,
    });
    for (const d of due) {
      await this.attemptDelivery(d.id).catch(() => {});
    }
  }

  /** Vérifie une signature entrante (utilitaire pour les consumers / tests). */
  static verifySignature(secret: string, timestamp: string, body: string, signature: string): boolean {
    const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const a = createHash('sha256').update(expected).digest();
    const b = createHash('sha256').update(signature.replace(/^sha256=/, '')).digest();
    return a.equals(b);
  }
}
