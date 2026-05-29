import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BookingsService } from '../bookings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { createMockPrisma } from '../../common/test/mock-prisma';
import { NotificationType } from '@transpro/shared';

jest.mock('@transpro/shared', () => ({
  ...jest.requireActual('@transpro/shared'),
  generateReference: () => 'TP-MOCK-REF',
  BOOKING_EXPIRY_MINUTES: 15,
}));

const mockPrisma       = createMockPrisma();
const mockRealtime     = { broadcastToTrip: jest.fn(), broadcastToCompany: jest.fn(), sendToUser: jest.fn() };
const mockNotifications = { create: jest.fn().mockResolvedValue({}) };
const mockConfig       = { get: jest.fn((key: string) => {
  if (key === 'TICKET_SECRET') return 'test-secret';
  if (key === 'ENCRYPTION_KEY') return 'test-encryption-key';
  return undefined;
}) };

const LOGO_URL = 'https://example.com/logo.png';

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
  // advancedSeatManagement: true → effectiveASM short-circuits (no vehicle access needed)
  advancedSeatManagement: true,
  tenant: { name: 'Transport Express CI', logo: LOGO_URL },
  route: { name: 'Abidjan → Bouaké', originCity: { name: 'Abidjan' }, destinationCity: { name: 'Bouaké' } },
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
        { provide: PrismaService,       useValue: mockPrisma        },
        { provide: RealtimeService,     useValue: mockRealtime      },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ConfigService,       useValue: mockConfig        },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
    jest.clearAllMocks();
  });

  // ── create ────────────────────────────────────────────────────────────────────

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
        trip: { ...mockTrip },
      };

      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, seats: [] });
      mockPrisma.tripSeat.findMany.mockResolvedValue(seatNumbers.map(mockAvailableSeat));
      mockPrisma.$transaction.mockResolvedValue(mockBooking);

      const result = await service.create('user-1', { tripId: 'trip-1', seatNumbers });

      expect(result).toMatchObject({ reference: 'TP-MOCK-REF', totalAmount: 12000 });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockRealtime.broadcastToTrip).toHaveBeenCalledTimes(2);
    });

    it('should send BOOKING_CONFIRMED notification with templateData and logo', async () => {
      const seatNumbers = ['1A'];
      const mockBooking = {
        id: 'booking-1',
        seatNumbers,
        trip: { ...mockTrip },
      };

      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, seats: [] });
      mockPrisma.tripSeat.findMany.mockResolvedValue(seatNumbers.map(mockAvailableSeat));
      mockPrisma.$transaction.mockResolvedValue(mockBooking);

      await service.create('user-1', { tripId: 'trip-1', seatNumbers });

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.BOOKING_CONFIRMED,
          templateData: { origin: 'Abidjan', destination: 'Bouaké' },
          companyLogo: LOGO_URL,
        }),
      );
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

    it('should throw ConflictException when seat is already reserved (lock fails in tx)', async () => {
      // La vérification est maintenant atomique DANS la transaction via reserveSeats().
      // On simule le cas où updateMany retourne count=0 → ConflictException.
      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, seats: [] });
      mockPrisma.$transaction.mockRejectedValue(
        new ConflictException('1 siège(s) ne sont plus disponibles — veuillez actualiser et réessayer'),
      );

      await expect(
        service.create('user-1', { tripId: 'trip-1', seatNumbers: ['1A'] }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when seat lock expires atomically in tx', async () => {
      // Même scénario : siège AVAILABLE mais son lock n'expire pas encore →
      // updateMany conditionnel retourne count=0 → ConflictException depuis la tx.
      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, seats: [] });
      mockPrisma.$transaction.mockRejectedValue(
        new ConflictException('1 siège(s) ne sont plus disponibles — veuillez actualiser et réessayer'),
      );

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
        trip: { ...mockTrip },
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

  // ── cancel ────────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    const mockBooking = {
      id: 'booking-1',
      passengerId: 'user-1',
      tripId: 'trip-1',
      tenantId: 'tenant-1',
      seatNumbers: ['1A', '1B'],
      status: 'CONFIRMED',
      payment: null,
      trip: { tenant: { logo: LOGO_URL } },
    };

    it('should cancel a booking and release seats', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
      mockPrisma.$transaction.mockResolvedValue(undefined);

      await service.cancel('booking-1', 'user-1');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockRealtime.broadcastToTrip).toHaveBeenCalledTimes(2);
    });

    it('should send BOOKING_CANCELLED notification with templateData and logo', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
      mockPrisma.$transaction.mockResolvedValue(undefined);

      await service.cancel('booking-1', 'user-1');

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.BOOKING_CANCELLED,
          templateData: {},
          companyLogo: LOGO_URL,
        }),
      );
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

  // ── expireUnpaidBookings (cron) ───────────────────────────────────────────────

  describe('expireUnpaidBookings (cron)', () => {
    it('should expire all pending bookings past their deadline', async () => {
      const expiredBookings = [
        { id: 'b1', tripId: 'trip-1', passengerId: 'u1', tenantId: 'tenant-1', seatNumbers: ['1A'], trip: { tenant: { logo: LOGO_URL } } },
        { id: 'b2', tripId: 'trip-1', passengerId: 'u2', tenantId: 'tenant-1', seatNumbers: ['2A', '2B'], trip: { tenant: { logo: null } } },
      ];
      mockPrisma.booking.findMany.mockResolvedValue(expiredBookings);
      mockPrisma.$transaction.mockResolvedValue(undefined);

      await service.expireUnpaidBookings();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      expect(mockRealtime.broadcastToTrip).toHaveBeenCalledTimes(3); // 1 + 2 sièges
    });

    it('should send BOOKING_EXPIRED notification for each expired booking', async () => {
      const expiredBookings = [
        { id: 'b1', tripId: 'trip-1', passengerId: 'u1', tenantId: 'tenant-1', seatNumbers: ['1A'], trip: { tenant: { logo: LOGO_URL } } },
      ];
      mockPrisma.booking.findMany.mockResolvedValue(expiredBookings);
      mockPrisma.$transaction.mockResolvedValue(undefined);

      await service.expireUnpaidBookings();

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.BOOKING_EXPIRED,
          templateData: {},
          companyLogo: LOGO_URL,
        }),
      );
    });

    it('should do nothing when no expired bookings', async () => {
      mockPrisma.booking.findMany.mockResolvedValue([]);

      await service.expireUnpaidBookings();

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockRealtime.broadcastToTrip).not.toHaveBeenCalled();
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });
  });

  // ── createGuichet ─────────────────────────────────────────────────────────────

  describe('createGuichet', () => {
    const mockGuichetTrip = {
      ...mockTrip,
      route: { name: 'Abidjan → Bouaké', originCity: { name: 'Abidjan' }, destinationCity: { name: 'Bouaké' } },
      tenant: { name: 'Transport Express CI', logo: LOGO_URL },
      seats: [mockAvailableSeat('1A'), mockAvailableSeat('1B')],
      vehicle: { advancedSeatManagement: true },
    };

    const mockCreatedBooking = { id: 'booking-guichet-1', seatNumbers: ['1A'] };
    const mockFinalBooking = {
      id: 'booking-guichet-1',
      passenger: { firstName: 'Client', lastName: 'Anonyme', phone: '+225 07 00 00 00', email: 'test@test.ci' },
      trip: mockGuichetTrip,
      tickets: [],
      payment: { method: 'CASH', status: 'SUCCESS', paidAt: new Date() },
    };

    it('should create a guichet booking with CONFIRMED status and existing user', async () => {
      const existingPassenger = { id: 'passenger-1', phone: '+225 07 00 00 00' };
      mockPrisma.trip.findFirst.mockResolvedValue(mockGuichetTrip);
      mockPrisma.tripSeat.findMany.mockResolvedValue([mockAvailableSeat('1A')]);
      mockPrisma.user.findFirst.mockResolvedValue(existingPassenger);
      mockPrisma.$transaction.mockResolvedValue(mockCreatedBooking);
      mockPrisma.booking.findUnique.mockResolvedValue(mockFinalBooking);

      const result = await service.createGuichet('tenant-1', 'agent-1', {
        tripId: 'trip-1',
        seatNumbers: ['1A'],
        phone: '+225 07 00 00 00',
        paymentMethod: 'CASH' as any,
      });

      expect(result).toBeDefined();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.TICKET_READY }),
      );
    });

    it('should create a new anonymous passenger when phone not found', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockGuichetTrip);
      mockPrisma.tripSeat.findMany.mockResolvedValue([mockAvailableSeat('1A')]);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-passenger-1' });
      mockPrisma.$transaction.mockResolvedValue(mockCreatedBooking);
      mockPrisma.booking.findUnique.mockResolvedValue(mockFinalBooking);

      await service.createGuichet('tenant-1', 'agent-1', {
        tripId: 'trip-1',
        seatNumbers: ['1A'],
      });

      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException when trip not found', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(null);

      await expect(
        service.createGuichet('tenant-1', 'agent-1', { tripId: 'nonexistent', seatNumbers: ['1A'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when trip is not bookable', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue({ ...mockGuichetTrip, status: 'DEPARTED' });

      await expect(
        service.createGuichet('tenant-1', 'agent-1', { tripId: 'trip-1', seatNumbers: ['1A'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should auto-assign seats when advancedSeatManagement is false', async () => {
      const simpleTrip = {
        ...mockGuichetTrip,
        advancedSeatManagement: false,
        vehicle: { advancedSeatManagement: false },
        seats: [mockAvailableSeat('1A'), mockAvailableSeat('1B')],
      };
      mockPrisma.trip.findFirst.mockResolvedValue(simpleTrip);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'p1' });
      mockPrisma.$transaction.mockResolvedValue(mockCreatedBooking);
      mockPrisma.booking.findUnique.mockResolvedValue(mockFinalBooking);

      await service.createGuichet('tenant-1', 'agent-1', {
        tripId: 'trip-1',
        passengerCount: 1,
      });

      // No tripSeat.findMany call — auto-assign uses in-memory seats
      expect(mockPrisma.tripSeat.findMany).not.toHaveBeenCalled();
    });
  });

  // ── rateBooking ───────────────────────────────────────────────────────────────

  describe('rateBooking', () => {
    it('should upsert a trip rating for a completed booking', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue({ id: 'booking-1' });
      mockPrisma.tripRating.upsert.mockResolvedValue({ id: 'rating-1', rating: 5 });

      const result = await service.rateBooking('booking-1', 'user-1', { rating: 5, comment: 'Excellent !' });

      expect(mockPrisma.tripRating.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bookingId: 'booking-1' },
          create: expect.objectContaining({ rating: 5, comment: 'Excellent !' }),
        }),
      );
      expect(result).toMatchObject({ rating: 5 });
    });

    it('should throw NotFoundException when booking is not completed or not owned by user', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.rateBooking('booking-1', 'user-1', { rating: 4 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
