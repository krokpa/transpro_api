import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { createMockPrisma } from '../../common/test/mock-prisma';
import { COMMISSION_RATE } from '@transpro/shared';

jest.mock('@transpro/shared', () => ({
  ...jest.requireActual('@transpro/shared'),
  generateReference: () => 'PAY-MOCK-REF',
  COMMISSION_RATE: 0.04,
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockQR'),
}));

jest.mock('axios');

const mockPrisma = createMockPrisma();
const mockRealtime = { broadcastToTrip: jest.fn(), broadcastToCompany: jest.fn(), sendToUser: jest.fn() };
const mockNotifications = { create: jest.fn().mockResolvedValue({}) };

const mockBooking = {
  id: 'booking-1',
  tenantId: 'tenant-1',
  tripId: 'trip-1',
  passengerId: 'user-1',
  reference: 'TP-MOCK-REF',
  seatNumbers: ['1A', '1B'],
  totalAmount: 12000,
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 900000),
  payment: null,
  trip: {
    id: 'trip-1',
    tenantId: 'tenant-1',
    route: { originCity: { name: 'Abidjan' }, destinationCity: { name: 'Bouaké' } },
    tenant: { name: 'Transport Express CI' },
  },
  passenger: {
    id: 'user-1',
    firstName: 'Amani',
    lastName: 'Koné',
    email: 'amani@test.ci',
    phone: '+2250712345678',
  },
};

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RealtimeService, useValue: mockRealtime },
        { provide: NotificationsService, useValue: mockNotifications },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                CINETPAY_API_KEY: 'test-api-key',
                CINETPAY_SITE_ID: 'test-site-id',
                CINETPAY_NOTIFY_URL: 'http://localhost:3001/payments/notify',
                ENCRYPTION_KEY: '32-char-key-for-qr-code-signing!!',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    jest.clearAllMocks();
  });

  describe('commission calculation', () => {
    it('should calculate 4% commission correctly', () => {
      const amount = 12000;
      const expectedCommission = Math.round(amount * COMMISSION_RATE);
      const expectedNet = amount - expectedCommission;

      expect(expectedCommission).toBe(480);
      expect(expectedNet).toBe(11520);
    });

    it('should round commission for odd amounts', () => {
      const amount = 5500;
      const commission = Math.round(amount * 0.04);
      expect(commission).toBe(220);
      expect(amount - commission).toBe(5280);
    });
  });

  describe('initiate', () => {
    it('should create a payment record with correct amounts', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
      mockPrisma.payment.create.mockResolvedValue({
        id: 'payment-1',
        bookingId: 'booking-1',
        amount: 12000,
        commissionAmount: 480,
        netAmount: 11520,
      });
      mockPrisma.payment.update.mockResolvedValue({});

      const axios = require('axios');
      axios.post = jest.fn().mockResolvedValue({
        data: { data: { checkout_url: 'https://pay.genius.ci/pay/xxx', reference: 'GEN-REF' } },
      });

      await service.initiate('booking-1', 'user-1');

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 12000,
            commissionAmount: 480,
            netAmount: 11520,
          }),
        }),
      );
    });

    it('should throw NotFoundException for unknown booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(null);

      await expect(service.initiate('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when user does not own booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        ...mockBooking,
        passengerId: 'other-user',
      });

      await expect(service.initiate('booking-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for expired booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        ...mockBooking,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.initiate('booking-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when payment already exists', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        ...mockBooking,
        payment: { id: 'existing-payment' },
      });

      await expect(service.initiate('booking-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('scanTicket', () => {
    it('should reject invalid JSON in QR data', async () => {
      await expect(service.scanTicket('not-valid-json', 'agent-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject tampered QR codes (wrong signature)', async () => {
      const fakeData = JSON.stringify({
        bookingRef: 'TP-MOCK-REF',
        tripId: 'trip-1',
        seatNumber: '1A',
        passengerId: 'user-1',
        issuedAt: new Date().toISOString(),
        sig: 'wrong-signature',
      });

      await expect(service.scanTicket(fakeData, 'agent-1')).rejects.toThrow(BadRequestException);
    });

    it('should reject already-scanned tickets', async () => {
      const qrData = JSON.stringify({
        bookingRef: 'TP-MOCK-REF',
        tripId: 'trip-1',
        seatNumber: '1A',
        passengerId: 'user-1',
        issuedAt: '2025-01-01T00:00:00.000Z',
        sig: 'valid-sig',
      });

      // Simulate the service's signature check passing by making ticket found
      mockPrisma.ticket.findFirst.mockResolvedValue({
        id: 'ticket-1',
        qrCodeData: qrData,
        isScanned: true,
        booking: { status: 'CONFIRMED', trip: { route: {} } },
      });

      // We need to bypass the signature check for this test
      // In practice, sign with the real ENCRYPTION_KEY
      jest.spyOn(service as any, 'signTicket').mockReturnValue('valid-sig');

      await expect(service.scanTicket(qrData, 'agent-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleGeniusPayWebhook', () => {
    it('should confirm payment on success event', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        bookingId: 'booking-1',
        status: 'PROCESSING',
      });

      const confirmSpy = jest.spyOn(service, 'confirmPayment').mockResolvedValue(undefined);

      await service.handleGeniusPayWebhook(
        JSON.stringify({ event: 'payment.success', data: { metadata: { transactionId: 'PAY-MOCK-REF' } } }),
        '',
        '',
      );

      expect(confirmSpy).toHaveBeenCalledWith('booking-1', 'payment-1');
    });

    it('should mark payment failed on failure event', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        bookingId: 'booking-1',
        status: 'PROCESSING',
        booking: { ...mockBooking },
      });
      mockPrisma.$transaction = jest.fn().mockResolvedValue(undefined);

      await service.handleGeniusPayWebhook(
        JSON.stringify({ event: 'payment.failed', data: { metadata: { transactionId: 'PAY-MOCK-REF' } } }),
        '',
        '',
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should silently ignore unknown transaction ids', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.handleGeniusPayWebhook(
          JSON.stringify({ event: 'payment.success', data: { metadata: { transactionId: 'UNKNOWN' } } }),
          '',
          '',
        ),
      ).resolves.not.toThrow();
    });
  });
});
