import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ParcelsService } from '../parcels.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { EmailService } from '../../email/email.service';
import { SmsService } from '../../sms/sms.service';
import { ConfigService } from '@nestjs/config';
import { createMockPrisma } from '../../common/test/mock-prisma';

jest.mock('@transpro/shared', () => ({
  ...jest.requireActual('@transpro/shared'),
  generateReference: () => 'TP-COL-MOCK',
  calculateParcelFee: jest.fn().mockReturnValue(1500),
  PARCEL_MAX_WEIGHT_KG: 50,
}));

const mockPrisma        = createMockPrisma();
const mockNotifications = { create: jest.fn().mockResolvedValue({}) };
const mockEmail         = { sendParcelCreated: jest.fn().mockResolvedValue({}), sendParcelStatusUpdate: jest.fn().mockResolvedValue({}) };
const mockSms           = {
  send: jest.fn().mockResolvedValue({}),
  parcelCreated:  jest.fn().mockReturnValue('SMS créé'),
  parcelCollected: jest.fn().mockReturnValue('SMS collecté'),
  parcelInTransit: jest.fn().mockReturnValue('SMS transit'),
  parcelArrived:   jest.fn().mockReturnValue('SMS arrivé'),
  parcelDelivered: jest.fn().mockReturnValue('SMS livré'),
};
const mockConfig        = { get: jest.fn().mockReturnValue('https://app.transpro.ci') };

const TENANT_ID = 'tenant-1';
const AGENT_ID  = 'agent-1';

const mockTrip = {
  id: 'trip-1',
  tenantId: TENANT_ID,
  status: 'SCHEDULED',
  route: { distanceKm: 340, originCity: { name: 'Abidjan' } },
};

const mockParcel = {
  id: 'parcel-1',
  trackingCode: 'TP-COL-MOCK',
  status: 'PENDING',
  senderId: null,
  senderName: 'Koffi Yao',
  senderPhone: '+225 07 00 00 00',
  senderEmail: 'koffi@test.ci',
  recipientName: 'Awa Diallo',
  recipientPhone: '+225 05 00 00 00',
  deliveryCity: 'Bouaké',
  description: 'Habits',
  weightKg: 2,
  fragile: false,
  declaredValue: null,
  fee: 1500,
  currency: 'XOF',
  isPaid: false,
  paymentMethod: null,
  notes: null,
  collectedAt: null,
  departedAt: null,
  arrivedAt: null,
  deliveredAt: null,
  returnedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  trip: null,
  agent: null,
  station: null,
};

describe('ParcelsService', () => {
  let service: ParcelsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParcelsService,
        { provide: PrismaService,        useValue: mockPrisma        },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: EmailService,         useValue: mockEmail         },
        { provide: SmsService,           useValue: mockSms           },
        { provide: ConfigService,        useValue: mockConfig        },
      ],
    }).compile();

    service = module.get<ParcelsService>(ParcelsService);
    jest.clearAllMocks();
  });

  // ── create ────────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      tripId: 'trip-1',
      senderName: 'Koffi Yao',
      senderPhone: '+225 07 00 00 00',
      senderEmail: 'koffi@test.ci',
      recipientName: 'Awa Diallo',
      recipientPhone: '+225 05 00 00 00',
      deliveryCity: 'Bouaké',
      description: 'Habits',
      weightKg: 2,
    };

    it('should create a parcel and return it', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.parcel.create.mockResolvedValue(mockParcel);

      const result = await service.create(TENANT_ID, AGENT_ID, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.parcel.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.parcel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            trackingCode: 'TP-COL-MOCK',
            senderName: 'Koffi Yao',
            deliveryCity: 'Bouaké',
            status: 'PENDING',
            currency: 'XOF',
          }),
        }),
      );
    });

    it('should dispatch SMS notification for unregistered sender', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.parcel.create.mockResolvedValue(mockParcel);

      await service.create(TENANT_ID, AGENT_ID, dto);

      // Notification runs asynchronously — give the microtask queue a tick
      await Promise.resolve();
      expect(mockSms.send).toHaveBeenCalledWith(
        '+225 07 00 00 00',
        expect.any(String),
      );
    });

    it('should dispatch push + email for registered passenger sender', async () => {
      const senderUser = { id: 'user-1', firstName: 'Koffi', lastName: 'Yao', phone: '+225 07', email: 'koffi@test.ci' };
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.parcel.create.mockResolvedValue({ ...mockParcel, senderId: 'user-1' });

      await service.create(TENANT_ID, AGENT_ID, dto, senderUser);

      await Promise.resolve();
      expect(mockEmail.sendParcelCreated).toHaveBeenCalled();
      expect(mockNotifications.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException when trip not found', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(null);

      await expect(service.create(TENANT_ID, AGENT_ID, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when trip is not SCHEDULED or BOARDING', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue({ ...mockTrip, status: 'DEPARTED' });

      await expect(service.create(TENANT_ID, AGENT_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when weight exceeds maximum', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);

      await expect(
        service.create(TENANT_ID, AGENT_ID, { ...dto, weightKg: 51 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when sender info is missing for anonymous sender', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);

      await expect(
        service.create(TENANT_ID, AGENT_ID, { ...dto, senderName: '', senderPhone: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── trackByCode ───────────────────────────────────────────────────────────────

  describe('trackByCode', () => {
    it('should return parcel tracking info for a valid code', async () => {
      mockPrisma.parcel.findUnique.mockResolvedValue(mockParcel);

      const result = await service.trackByCode('TP-COL-MOCK');

      expect(result).toBeDefined();
      expect(mockPrisma.parcel.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { trackingCode: 'TP-COL-MOCK' } }),
      );
    });

    it('should throw NotFoundException for an unknown tracking code', async () => {
      mockPrisma.parcel.findUnique.mockResolvedValue(null);

      await expect(service.trackByCode('INVALID')).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateStatus ──────────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    const pendingParcel = {
      id: 'parcel-1',
      status: 'PENDING',
      senderId: null,
      senderName: 'Koffi',
      senderPhone: '+225 07',
      senderEmail: 'k@t.ci',
      trackingCode: 'TP-COL-MOCK',
      deliveryCity: 'Bouaké',
    };

    it('should update PENDING → COLLECTED and set collectedAt', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue(pendingParcel);
      mockPrisma.parcel.update.mockResolvedValue({ ...mockParcel, status: 'COLLECTED', collectedAt: new Date() });

      const result = await service.updateStatus('parcel-1', TENANT_ID, { status: 'COLLECTED' });

      expect(mockPrisma.parcel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COLLECTED', collectedAt: expect.any(Date) }),
        }),
      );
      expect(result.status).toBe('COLLECTED');
    });

    it('should update COLLECTED → IN_TRANSIT', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue({ ...pendingParcel, status: 'COLLECTED' });
      mockPrisma.parcel.update.mockResolvedValue({ ...mockParcel, status: 'IN_TRANSIT', departedAt: new Date() });

      const result = await service.updateStatus('parcel-1', TENANT_ID, { status: 'IN_TRANSIT' });

      expect(result.status).toBe('IN_TRANSIT');
    });

    it('should throw BadRequestException for invalid status transition', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue(pendingParcel); // PENDING

      await expect(
        service.updateStatus('parcel-1', TENANT_ID, { status: 'DELIVERED' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when transitioning from a terminal status', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue({ ...pendingParcel, status: 'DELIVERED' });

      await expect(
        service.updateStatus('parcel-1', TENANT_ID, { status: 'RETURNED' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when parcel not found', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStatus('nonexistent', TENANT_ID, { status: 'COLLECTED' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should dispatch SMS for anonymous sender on status change', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue(pendingParcel);
      mockPrisma.parcel.update.mockResolvedValue({ ...mockParcel, status: 'COLLECTED' });

      await service.updateStatus('parcel-1', TENANT_ID, { status: 'COLLECTED' });

      await Promise.resolve();
      expect(mockSms.send).toHaveBeenCalled();
    });
  });

  // ── estimateFee ───────────────────────────────────────────────────────────────

  describe('estimateFee', () => {
    it('should return fee and currency for a valid trip', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ route: { distanceKm: 340 } });

      const result = await service.estimateFee('trip-1', 2);

      expect(result).toEqual({ fee: 1500, currency: 'XOF' });
    });

    it('should throw NotFoundException for unknown trip', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue(null);

      await expect(service.estimateFee('nonexistent', 2)).rejects.toThrow(NotFoundException);
    });
  });

  // ── findByTrip ────────────────────────────────────────────────────────────────

  describe('findByTrip', () => {
    it('should return parcels for a valid trip', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.parcel.findMany.mockResolvedValue([mockParcel]);

      const result = await service.findByTrip('trip-1', TENANT_ID);

      expect(result).toHaveLength(1);
    });

    it('should throw NotFoundException for unknown trip', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(null);

      await expect(service.findByTrip('nonexistent', TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── addPhotos ─────────────────────────────────────────────────────────────────

  describe('addPhotos', () => {
    const PARCEL_ID = 'parcel-1';
    const photos    = ['data:image/jpeg;base64,/9j/photo1', 'data:image/jpeg;base64,/9j/photo2'];

    it('should save up to 2 photos and return updated parcel', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue({ id: PARCEL_ID, photos: [] });
      mockPrisma.parcel.update.mockResolvedValue({ ...mockParcel, photos });

      const result = await service.addPhotos(PARCEL_ID, TENANT_ID, { photos });

      expect(mockPrisma.parcel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PARCEL_ID },
          data: { photos },
        }),
      );
      expect(result).toBeDefined();
    });

    it('should allow replacing photos with a single photo', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue({ id: PARCEL_ID, photos });
      mockPrisma.parcel.update.mockResolvedValue({ ...mockParcel, photos: [photos[0]] });

      await service.addPhotos(PARCEL_ID, TENANT_ID, { photos: [photos[0]] });

      expect(mockPrisma.parcel.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { photos: [photos[0]] } }),
      );
    });

    it('should allow clearing all photos with an empty array', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue({ id: PARCEL_ID, photos });
      mockPrisma.parcel.update.mockResolvedValue({ ...mockParcel, photos: [] });

      await service.addPhotos(PARCEL_ID, TENANT_ID, { photos: [] });

      expect(mockPrisma.parcel.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { photos: [] } }),
      );
    });

    it('should throw BadRequestException when more than 2 photos are provided', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue({ id: PARCEL_ID, photos: [] });

      await expect(
        service.addPhotos(PARCEL_ID, TENANT_ID, { photos: [...photos, 'data:image/jpeg;base64,extra'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when parcel does not belong to tenant', async () => {
      mockPrisma.parcel.findFirst.mockResolvedValue(null);

      await expect(
        service.addPhotos('nonexistent', TENANT_ID, { photos }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
