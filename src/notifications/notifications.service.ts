import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, SocketEvent } from '@transpro/shared';
import { RealtimeService } from '../realtime/realtime.service';
import { PushService } from '../push/push.service';
import { buildNotificationTranslations, getNotificationText } from './notification-i18n';
import {
  CampaignConfig,
  DEFAULT_CAMPAIGN_CONFIG,
  UpsertCampaignConfigDto,
} from './dto/campaign-config.dto';

export interface CreateNotificationDto {
  userId: string;
  type: NotificationType;
  /** Direct title — required when templateData is not provided. */
  title?: string;
  /** Direct message — required when templateData is not provided. */
  message?: string;
  /** Variables for i18n template lookup. When set, title/message are derived from the template. */
  templateData?: Record<string, string>;
  data?: Record<string, any>;
  channel?: 'IN_APP' | 'SMS' | 'EMAIL' | 'PUSH';
  push?: boolean;
  companyLogo?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private push: PushService,
  ) {}

  async findByUser(userId: string, onlyUnread?: boolean) {
    const where: any = { userId };
    if (onlyUnread) {
      where.isRead = false;
    }

    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) throw new NotFoundException('Notification introuvable');

    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return { updated: result.count, message: 'Toutes les notifications ont été marquées comme lues' };
  }

  async create(dto: CreateNotificationDto) {
    let resolvedTitle = dto.title ?? '';
    let resolvedMessage = dto.message ?? '';
    let translations: Record<string, { title: string; message: string }> | undefined;

    if (dto.templateData !== undefined) {
      translations = buildNotificationTranslations(dto.type, dto.templateData);

      // Fetch the user's preferred language to store the right text in DB
      const user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { preferredLang: true },
      });
      const lang = user?.preferredLang ?? 'fr';
      const text = getNotificationText(dto.type, dto.templateData, lang);
      resolvedTitle   = text.title   || dto.title   || '';
      resolvedMessage = text.message || dto.message || '';
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        title: resolvedTitle,
        message: resolvedMessage,
        data: dto.data ?? {},
        channel: dto.channel ?? 'IN_APP',
        isRead: false,
      },
    });

    // Real-time in-app via WebSocket
    this.realtime.sendToUser(dto.userId, SocketEvent.NOTIFICATION, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      createdAt: notification.createdAt,
    });

    // Push notification (opt-in via dto.push, defaults to true)
    if (dto.push !== false) {
      this.push.sendToUser(dto.userId, {
        title: resolvedTitle,
        message: resolvedMessage,
        data: { notificationId: notification.id, type: dto.type, ...dto.data },
        largeIconUrl: dto.companyLogo,
        translations,
      });
    }

    return notification;
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  // ── Campaign config ────────────────────────────────────────────────────────

  async getCampaignConfig(tenantId: string): Promise<CampaignConfig> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    if (!tenant) throw new NotFoundException('Compagnie introuvable');
    const settings = tenant.settings as Record<string, any> | null;
    return { ...DEFAULT_CAMPAIGN_CONFIG, ...(settings?.campaignConfig ?? {}) };
  }

  async getCampaignConfigByUserId(userId: string): Promise<CampaignConfig> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    if (!user?.tenantId) throw new NotFoundException('Compagnie introuvable');
    return this.getCampaignConfig(user.tenantId);
  }

  async upsertCampaignConfig(
    userId: string,
    dto: UpsertCampaignConfigDto,
  ): Promise<CampaignConfig> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    if (!user?.tenantId) throw new NotFoundException('Compagnie introuvable');

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { settings: true },
    });
    const current = (tenant?.settings as Record<string, any>) ?? {};
    const updatedConfig: CampaignConfig = {
      ...DEFAULT_CAMPAIGN_CONFIG,
      ...(current.campaignConfig ?? {}),
      ...dto,
    };

    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { settings: { ...current, campaignConfig: updatedConfig } },
    });

    return updatedConfig;
  }
}
