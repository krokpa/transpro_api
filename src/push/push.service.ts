import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as webpush from 'web-push';

export interface PushPayload {
  title: string;
  message: string;
  data?: Record<string, any>;
  largeIconUrl?: string;
  translations?: Record<string, { title: string; message: string }>;
}

export interface WebPushSubscribeDto {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  // OneSignal (mobile passagers)
  private readonly oneSignalAppId: string;
  private readonly oneSignalApiKey: string;
  private readonly oneSignalEnabled: boolean;

  // Web Push VAPID (dashboard staff)
  private readonly vapidPublicKey: string;
  private readonly vapidPrivateKey: string;
  private readonly webPushEnabled: boolean;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.oneSignalAppId  = this.config.get('ONESIGNAL_APP_ID', '');
    this.oneSignalApiKey = this.config.get('ONESIGNAL_REST_API_KEY', '');
    this.oneSignalEnabled = !!(this.oneSignalAppId && this.oneSignalApiKey);

    this.vapidPublicKey  = this.config.get('VAPID_PUBLIC_KEY', '');
    this.vapidPrivateKey = this.config.get('VAPID_PRIVATE_KEY', '');
    this.webPushEnabled  = !!(this.vapidPublicKey && this.vapidPrivateKey);

    if (this.webPushEnabled) {
      webpush.setVapidDetails(
        `mailto:${this.config.get('VAPID_CONTACT_EMAIL', 'admin@transpro.ci')}`,
        this.vapidPublicKey,
        this.vapidPrivateKey,
      );
    } else {
      this.logger.warn('Web Push disabled — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable');
    }

    if (!this.oneSignalEnabled) {
      this.logger.warn('OneSignal disabled — set ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY to enable push');
    }
  }

  /** Clé publique VAPID à exposer au frontend pour l'enregistrement du Service Worker. */
  getVapidPublicKey(): string {
    return this.vapidPublicKey;
  }

  // ─── Abonnements Web Push ──────────────────────────────────────────────────

  async subscribe(userId: string, dto: WebPushSubscribeDto) {
    return this.prisma.webPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent: dto.userAgent,
      },
      update: {
        userId,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent: dto.userAgent,
      },
    });
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.webPushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  // ─── Envoi Web Push (dashboard staff) ─────────────────────────────────────

  async sendWebPushToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.webPushEnabled) return;

    const subs = await this.prisma.webPushSubscription.findMany({ where: { userId } });
    await Promise.all(subs.map((sub) => this._sendWebPush(sub, payload)));
  }

  async sendWebPushToTenant(tenantId: string, payload: PushPayload): Promise<void> {
    if (!this.webPushEnabled) return;

    // Envoyer à tous les agents/admins/owners du tenant ayant un abonnement
    const subs = await this.prisma.webPushSubscription.findMany({
      where: { user: { tenantId, isActive: true } },
    });
    await Promise.all(subs.map((sub) => this._sendWebPush(sub, payload)));
  }

  private async _sendWebPush(
    sub: { endpoint: string; p256dh: string; auth: string },
    payload: PushPayload,
  ): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: payload.title, body: payload.message, data: payload.data ?? {} }),
        { TTL: 86400 },
      );
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Abonnement expiré → supprimer silencieusement
        await this.prisma.webPushSubscription.deleteMany({ where: { endpoint: sub.endpoint } }).catch(() => {});
      } else {
        this.logger.error(`Web push failed for ${sub.endpoint}: ${err.message}`);
      }
    }
  }

  // ─── OneSignal (mobile passagers) ─────────────────────────────────────────

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    return this.sendToUsers([userId], payload);
  }

  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    if (!this.oneSignalEnabled || userIds.length === 0) return;

    try {
      const largeIcon = payload.largeIconUrl?.startsWith('http') ? payload.largeIconUrl : undefined;
      const headings: Record<string, string> = { en: payload.title, fr: payload.title };
      const contents: Record<string, string> = { en: payload.message, fr: payload.message };
      if (payload.translations) {
        for (const [lang, t] of Object.entries(payload.translations)) {
          headings[lang] = t.title;
          contents[lang] = t.message;
        }
      }
      await axios.post(
        'https://onesignal.com/api/v1/notifications',
        {
          app_id: this.oneSignalAppId,
          include_aliases: { external_id: userIds },
          target_channel: 'push',
          headings,
          contents,
          ...(payload.data ? { data: payload.data } : {}),
          ...(largeIcon ? { large_icon: largeIcon, ios_attachments: { logo: largeIcon } } : {}),
        },
        {
          headers: {
            Authorization: `Basic ${this.oneSignalApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 8_000,
        },
      );
    } catch (err: any) {
      this.logger.error(
        `OneSignal push failed for [${userIds.join(', ')}]: ${err?.response?.data?.errors ?? err?.message}`,
      );
    }
  }
}
