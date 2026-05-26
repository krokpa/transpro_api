import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BookingsService } from '../bookings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { createMockPrisma, MockPrisma } from '../../common/test/mock-prisma';

jest.mock('@transpro/shared', () => ({
  ...jest.requireActual('@transpro/shared'),
  generateReference: () => 'TP-MOCK-REF',
  BOOKING_EXPIRY_MINUTES: 15,
}));

const mockPrisma = createMockPrisma();
const mockRealtime = { broadcastToTrip: jest.fn(), broadcastToCompany: jest.fn(), sendToUser: jest.fn() };
const mockNotifications = { create: jest.fn().mockResolvedValue({}) };
const mockConfig = { get: jest.fn((key: string) => key === 'TICKET_SECRET' ? 'test-secret' : undefined) };

const mockTrip = {
  id: 'trip-1',
  tenantId: 'tenant-1',
  routeId: 'route-1',
  vehicleId: 'vehicle-1',
  status: 'SCHEDULED',
  price: 6000,
  availableSeats: 36,
  totalSeats: 36,
  departureAt: new Date(Date.now() + 86400000),
};

const mockAvailableSeat = (seatNumber: string) => ({
  id: `seat-${seatNumber}`,
  tripId: 'trip-1',
  seatNumber,
  status: 'AVAILABLE',
  lockedAt: null,
  lockedBy: null,
  bookingId: null,
});

describe('BookingsService', () => {
  let service: BookingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RealtimeService, useValue: mockRealtime },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a booking and lock seats atomically', async () => {
      const seatNumbers = ['1A', '1B'];
      const mockBooking = {
        id: 'booking-1',
        reference: 'TP-MOCK-REF',
        tenantId: 'tenant-1',
        tripId: 'trip-1',
        passengerId: 'user-1',
        seatNumbers,
        status: 'PENDING',
        totalAmount: 12000,
        expiresAt: new Date(),
        trip: { ...mockTrip, route: { name: 'Test', originCity: 'Abidjan', destinationCity: 'Bouaké' } },
      };

      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, seats: [] });
      mockPrisma.tripSeat.findMany.mockResolvedValue(seatNumbers.map(mockAvailableSeat));
      mockPrisma.$transaction.mockResolvedValue(mockBooking);

      const result = await service.create('user-1', { tripId: 'trip-1', seatNumbers });

      expect(result).toMatchObject({ reference: 'TP-MOCK-REF', totalAmount: 12000 });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockRealtime.broadcastToTrip).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when trip does not exist', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', { tripId: 'nonexistent', seatNumbers: ['1A'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-bookable trip', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, status: 'CANCELLED', seats: [] });

      await expect(
        service.create('user-1', { tripId: 'trip-1', seatNumbers: ['1A'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when not enough seats available', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, availableSeats: 0, seats: [] });

      await expect(
        service.create('user-1', { tripId: 'trip-1', seatNumbers: ['1A'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when seat is already reserved', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, seats: [] });
      mockPrisma.tripSeat.findMany.mockResolvedValue([
        { ...mockAvailableSeat('1A'), status: 'RESERVED' },
      ]);

      await expect(
        service.create('user-1', { tripId: 'trip-1', seatNumbers: ['1A'] }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when seat is locked by another user', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, seats: [] });
      mockPrisma.tripSeat.findMany.mockResolvedValue([
        {
          ...mockAvailableSeat('1A'),
          status: 'AVAILABLE',
          lockedAt: new Date(Date.now() + 600000), // locked for 10 more minutes
          lockedBy: 'another-user',
        },
      ]);

      await expect(
        service.create('user-1', { tripId: 'trip-1', seatNumbers: ['1A'] }),
      ).rejects.toThrow(ConflictException);
    });

    it('should broadcast seat updates to trip room after successful booking', async () => {
      const seatNumbers = ['2A', '2B', '2C'];
      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, seats: [] });
      mockPrisma.tripSeat.findMany.mockResolvedValue(seatNumbers.map(mockAvailableSeat));
      mockPrisma.$transaction.mockResolvedValue({
        id: 'booking-1',
        seatNumbers,
        trip: { route: { originCity: { name: 'Abidjan' }, destinationCity: { name: 'Bouaké' } } },
      });

      await service.create('user-1', { tripId: 'trip-1', seatNumbers });

      expect(mockRealtime.broadcastToTrip).toHaveBeenCalledTimes(3);
      seatNumbers.forEach((seatNumber, i) => {
        expect(mockRealtime.broadcastToTrip).toHaveBeenNthCalledWith(
          i + 1,
          'trip-1',
          'seat:updated',
          expect.objectContaining({ seatNumber, status: 'RESERVED' }),
        );
      });
    });
  });

  describe('cancel', () => {
    const mockBooking = {
      id: 'booking-1',
      passengerId: 'user-1',
      tripId: 'trip-1',
      tenantId: 'tenant-1',
      seatNumbers: ['1A', '1B'],
      status: 'CONFIRMED',
      payment: null,
    };

    it('should cancel a booking and release seats', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
      mockPrisma.$transaction.mockResolvedValue(undefined);

      await service.cancel('booking-1', 'user-1');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockRealtime.broadcastToTrip).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException for unknown booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(null);

      await expect(service.cancel('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when user does not own booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({ ...mockBooking, passengerId: 'other-user' });

      await expect(service.cancel('booking-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when booking is already cancelled', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({ ...mockBooking, status: 'CANCELLED' });

      await expect(service.cancel('booking-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('expireUnpaidBookings (cron)', () => {
    it('should expire all pending bookings past their deadline', async () => {
      const expiredBookings = [
        { id: 'b1', tripId: 'trip-1', passengerId: 'u1', tenantId: 'tenant-1', seatNumbers: ['1A'] },
        { id: 'b2', tripId: 'trip-1', passengerId: 'u2', tenantId: 'tenant-1', seatNumbers: ['2A', '2B'] },
      ];
      mockPrisma.booking.findMany.mockResolvedValue(expiredBookings);
      mockPrisma.$transaction.mockResolvedValue(undefined);

      await service.expireUnpaidBookings();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      expect(mockRealtime.broadcastToTrip).toHaveBeenCalledTimes(3); // 1 + 2 sièges
    });

    it('should do nothing when no expired bookings', async () => {
      mockPrisma.booking.findMany.mockResolvedValue([]);

      await service.expireUnpaidBookings();

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockRealtime.broadcastToTrip).not.toHaveBeenCalled();
    });
  });
});
