import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, SocketEvent } from '@transpro/shared';
import { RealtimeService } from '../realtime/realtime.service';
import { PushService } from '../push/push.service';
import { buildNotificationTranslations, getNotificationText } from './notification-i18n';

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
}
