import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { PushService } from '../../push/push.service';
import { createMockPrisma } from '../../common/test/mock-prisma';
import { NotificationType } from '@transpro/shared';

const mockPrisma  = createMockPrisma();
const mockRealtime = { sendToUser: jest.fn(), broadcastToTrip: jest.fn(), broadcastToCompany: jest.fn() };
const mockPush    = { sendToUser: jest.fn(), sendToUsers: jest.fn() };

const FR_USER = { id: 'user-fr', preferredLang: 'fr' };
const EN_USER = { id: 'user-en', preferredLang: 'en' };

const mockNotification = (overrides = {}) => ({
  id: 'notif-1',
  userId: 'user-fr',
  type: NotificationType.BOOKING_CONFIRMED,
  title: 'Réservation créée',
  message: 'Votre réservation Abidjan → Bouaké est en attente de paiement.',
  data: {},
  channel: 'IN_APP',
  isRead: false,
  createdAt: new Date(),
  readAt: null,
  ...overrides,
});

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService,  useValue: mockPrisma   },
        { provide: RealtimeService, useValue: mockRealtime },
        { provide: PushService,    useValue: mockPush     },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  // ── create ────────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should store the raw title/message when no templateData is given', async () => {
      mockPrisma.notification.create.mockResolvedValue(mockNotification());

      await service.create({
        userId: 'user-fr',
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Custom title',
        message: 'Custom message',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Custom title', message: 'Custom message' }),
        }),
      );
      // Should NOT fetch user when no templateData
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should store French text for a French-language user when templateData is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(FR_USER);
      mockPrisma.notification.create.mockResolvedValue(mockNotification());

      await service.create({
        userId: 'user-fr',
        type: NotificationType.BOOKING_CONFIRMED,
        templateData: { origin: 'Abidjan', destination: 'Bouaké' },
      });

      const stored = (mockPrisma.notification.create as jest.Mock).mock.calls[0][0].data;
      expect(stored.title).toBe('Réservation créée');
      expect(stored.message).toContain('Abidjan → Bouaké');
    });

    it('should store English text for an English-language user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(EN_USER);
      mockPrisma.notification.create.mockResolvedValue(
        mockNotification({ title: 'Booking created', message: 'Your booking Abidjan → Bouaké is awaiting payment.' }),
      );

      await service.create({
        userId: 'user-en',
        type: NotificationType.BOOKING_CONFIRMED,
        templateData: { origin: 'Abidjan', destination: 'Bouaké' },
      });

      const stored = (mockPrisma.notification.create as jest.Mock).mock.calls[0][0].data;
      expect(stored.title).toBe('Booking created');
      expect(stored.message).toContain('Abidjan → Bouaké');
    });

    it('should pass bilingual translations to push when templateData is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(FR_USER);
      mockPrisma.notification.create.mockResolvedValue(mockNotification());

      await service.create({
        userId: 'user-fr',
        type: NotificationType.PAYMENT_SUCCESS,
        templateData: { origin: 'Abidjan', destination: 'Bouaké' },
      });

      const pushCall = (mockPush.sendToUser as jest.Mock).mock.calls[0][1];
      expect(pushCall.translations).toBeDefined();
      expect(pushCall.translations.fr.title).toBe('Paiement confirmé !');
      expect(pushCall.translations.en.title).toBe('Payment confirmed!');
    });

    it('should pass companyLogo as largeIconUrl to push', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(FR_USER);
      mockPrisma.notification.create.mockResolvedValue(mockNotification());

      await service.create({
        userId: 'user-fr',
        type: NotificationType.BOOKING_CONFIRMED,
        templateData: { origin: 'A', destination: 'B' },
        companyLogo: 'https://example.com/logo.png',
      });

      const pushCall = (mockPush.sendToUser as jest.Mock).mock.calls[0][1];
      expect(pushCall.largeIconUrl).toBe('https://example.com/logo.png');
    });

    it('should not call push when push is explicitly false', async () => {
      mockPrisma.notification.create.mockResolvedValue(mockNotification());

      await service.create({
        userId: 'user-fr',
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Test',
        message: 'Test',
        push: false,
      });

      expect(mockPush.sendToUser).not.toHaveBeenCalled();
    });

    it('should emit a real-time socket event after creating the notification', async () => {
      mockPrisma.notification.create.mockResolvedValue(mockNotification());

      await service.create({
        userId: 'user-fr',
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'T',
        message: 'M',
      });

      expect(mockRealtime.sendToUser).toHaveBeenCalledWith(
        'user-fr',
        'notification',
        expect.objectContaining({ type: NotificationType.BOOKING_CONFIRMED }),
      );
    });

    it('should fall back to French text when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.notification.create.mockResolvedValue(mockNotification());

      await service.create({
        userId: 'ghost-user',
        type: NotificationType.BOOKING_EXPIRED,
        templateData: {},
      });

      const stored = (mockPrisma.notification.create as jest.Mock).mock.calls[0][0].data;
      expect(stored.title).toBe('Réservation expirée');
    });
  });

  // ── findByUser ────────────────────────────────────────────────────────────────

  describe('findByUser', () => {
    it('should return all notifications for a user', async () => {
      const notifications = [mockNotification(), mockNotification({ id: 'notif-2', isRead: true })];
      mockPrisma.notification.findMany.mockResolvedValue(notifications);

      const result = await service.findByUser('user-fr');

      expect(result).toHaveLength(2);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-fr' } }),
      );
    });

    it('should filter by unread when onlyUnread is true', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([mockNotification()]);

      await service.findByUser('user-fr', true);

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-fr', isRead: false } }),
      );
    });
  });

  // ── markAsRead ────────────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('should mark a notification as read', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(mockNotification());
      mockPrisma.notification.update.mockResolvedValue({ ...mockNotification(), isRead: true });

      const result = await service.markAsRead('notif-1', 'user-fr');

      expect(result.isRead).toBe(true);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isRead: true }),
        }),
      );
    });

    it('should throw NotFoundException when notification does not belong to user', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markAsRead('notif-1', 'other-user')).rejects.toThrow(NotFoundException);
    });
  });

  // ── markAllAsRead ─────────────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read and return count', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllAsRead('user-fr');

      expect(result.updated).toBe(3);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-fr', isRead: false } }),
      );
    });
  });

  // ── getUnreadCount ────────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('should return the unread count for a user', async () => {
      mockPrisma.notification.count.mockResolvedValue(5);

      const result = await service.getUnreadCount('user-fr');

      expect(result.count).toBe(5);
    });
  });
});
