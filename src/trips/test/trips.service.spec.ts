import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TripsService } from '../trips.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PushService } from '../../push/push.service';
import { createMockPrisma } from '../../common/test/mock-prisma';
import { NotificationType, TripStatus } from '@transpro/shared';

const mockPrisma = createMockPrisma();
const mockRealtime = {
  broadcastToTrip: jest.fn(),
  broadcastToCompany: jest.fn(),
  sendToUser: jest.fn(),
};
const mockNotifications = { create: jest.fn().mockResolvedValue({}) };
const mockPush          = {
  sendToUser: jest.fn().mockResolvedValue(undefined),
  sendWebPushToTenant: jest.fn().mockResolvedValue(undefined),
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const LOGO_URL  = 'https://example.com/logo.png';

const mockRoute = {
  id: 'route-1',
  tenantId: TENANT_ID,
  name: 'Abidjan → Bouaké',
  durationMinutes: 240,
  isActive: true,
  originCity: { id: 'city-1', name: 'Abidjan' },
  destinationCity: { id: 'city-2', name: 'Bouaké' },
};

const mockVehicle = {
  id: 'vehicle-1',
  tenantId: TENANT_ID,
  plate: 'CI-1234-AB',
  capacity: 4,
  status: 'ACTIVE',
  seatLayout: { seats: [{ number: '1A' }, { number: '1B' }, { number: '2A' }, { number: '2B' }] },
};

const mockTrip = {
  id: 'trip-1',
  tenantId: TENANT_ID,
  routeId: 'route-1',
  vehicleId: 'vehicle-1',
  driverId: null,
  departureAt: new Date(Date.now() + 86400000),
  estimatedArrivalAt: new Date(Date.now() + 86400000 + 14400000),
  price: 6000,
  tripClass: 'STANDARD',
  status: 'SCHEDULED',
  availableSeats: 4,
  totalSeats: 4,
  delayMinutes: 0,
  notes: null,
  amenities: [],
  departureStationId: null,
};

/** Full trip shape returned by findUnique after an updateStatus call */
const fullMockTrip = {
  ...mockTrip,
  route: mockRoute,
  vehicle: mockVehicle,
  driver: null,
  tenant: { logo: LOGO_URL },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TripsService', () => {
  let service: TripsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TripsService,
        { provide: PrismaService,        useValue: mockPrisma        },
        { provide: RealtimeService,      useValue: mockRealtime      },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: PushService,          useValue: mockPush          },
      ],
    }).compile();

    service = module.get<TripsService>(TripsService);
    jest.clearAllMocks();
  });

  // ── create ────────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      routeId: 'route-1',
      vehicleId: 'vehicle-1',
      departureAt: new Date(Date.now() + 86400000).toISOString(),
      price: 6000,
    };

    it('should create a trip with seat layout from vehicle', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(mockRoute);
      mockPrisma.vehicle.findFirst.mockResolvedValue(mockVehicle);
      mockPrisma.trip.create.mockResolvedValue({
        ...mockTrip,
        route: mockRoute,
        vehicle: mockVehicle,
        seats: [
          { seatNumber: '1A', status: 'AVAILABLE' },
          { seatNumber: '1B', status: 'AVAILABLE' },
          { seatNumber: '2A', status: 'AVAILABLE' },
          { seatNumber: '2B', status: 'AVAILABLE' },
        ],
      });

      const result = await service.create(TENANT_ID, dto);

      expect(result.totalSeats).toBe(4);
      expect(mockPrisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            totalSeats: 4,
            availableSeats: 4,
            seats: {
              create: [
                { seatNumber: '1A', status: 'AVAILABLE' },
                { seatNumber: '1B', status: 'AVAILABLE' },
                { seatNumber: '2A', status: 'AVAILABLE' },
                { seatNumber: '2B', status: 'AVAILABLE' },
              ],
            },
          }),
        }),
      );
    });

    it('should throw NotFoundException when route does not exist', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(null);
      mockPrisma.vehicle.findFirst.mockResolvedValue(mockVehicle);

      await expect(service.create(TENANT_ID, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when vehicle does not exist', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(mockRoute);
      mockPrisma.vehicle.findFirst.mockResolvedValue(null);

      await expect(service.create(TENANT_ID, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for inactive vehicle', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(mockRoute);
      mockPrisma.vehicle.findFirst.mockResolvedValue({ ...mockVehicle, status: 'MAINTENANCE' });

      await expect(service.create(TENANT_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('should calculate estimatedArrivalAt from route duration when not provided', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(mockRoute); // durationMinutes: 240
      mockPrisma.vehicle.findFirst.mockResolvedValue(mockVehicle);
      mockPrisma.trip.create.mockResolvedValue({ ...mockTrip, route: mockRoute, vehicle: mockVehicle, seats: [] });

      await service.create(TENANT_ID, dto);

      const createCall = (mockPrisma.trip.create as jest.Mock).mock.calls[0][0];
      const departure = new Date(dto.departureAt).getTime();
      const expected = departure + 240 * 60 * 1000;
      const actual = new Date(createCall.data.estimatedArrivalAt).getTime();
      expect(Math.abs(actual - expected)).toBeLessThan(1000);
    });

    it('should set departureStationId when provided', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(mockRoute);
      mockPrisma.vehicle.findFirst.mockResolvedValue(mockVehicle);
      mockPrisma.trip.create.mockResolvedValue({ ...mockTrip, route: mockRoute, vehicle: mockVehicle, seats: [] });

      await service.create(TENANT_ID, { ...dto, departureStationId: 'station-1' });

      expect(mockPrisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ departureStationId: 'station-1' }),
        }),
      );
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all trips for the tenant', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([mockTrip]);

      const result = await service.findAll(TENANT_ID, {});

      expect(result).toHaveLength(1);
      expect(mockPrisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID } }),
      );
    });

    it('should filter by status', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([mockTrip]);

      await service.findAll(TENANT_ID, { status: TripStatus.SCHEDULED });

      expect(mockPrisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'SCHEDULED' }),
        }),
      );
    });

    it('should filter by date range when date is provided', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([]);

      await service.findAll(TENANT_ID, { date: '2025-01-15' });

      const where = (mockPrisma.trip.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.departureAt).toHaveProperty('gte');
      expect(where.departureAt).toHaveProperty('lte');
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return a trip by id', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, route: mockRoute, seats: [] });

      const result = await service.findOne('trip-1');

      expect(result.id).toBe('trip-1');
    });

    it('should throw NotFoundException when trip does not exist', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when tenantId does not match', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ ...mockTrip, tenantId: 'other-tenant', route: mockRoute, seats: [] });
      await expect(service.findOne('trip-1', TENANT_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getSeats ──────────────────────────────────────────────────────────────────

  describe('getSeats', () => {
    it('should return all seats for a trip ordered by seatNumber', async () => {
      const seats = [
        { id: 's1', tripId: 'trip-1', seatNumber: '1A', status: 'AVAILABLE' },
        { id: 's2', tripId: 'trip-1', seatNumber: '1B', status: 'RESERVED' },
      ];
      mockPrisma.tripSeat.findMany.mockResolvedValue(seats);

      const result = await service.getSeats('trip-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.tripSeat.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tripId: 'trip-1' } }),
      );
    });
  });

  // ── updateStatus ──────────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('should update trip status and broadcast', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.trip.update.mockResolvedValue({ ...mockTrip, status: 'BOARDING' });
      mockPrisma.trip.findUnique.mockResolvedValue({ ...fullMockTrip, status: 'BOARDING' });

      await service.updateStatus('trip-1', TENANT_ID, { status: TripStatus.BOARDING });

      expect(mockPrisma.trip.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trip-1' },
          data: expect.objectContaining({ status: 'BOARDING' }),
        }),
      );
      expect(mockRealtime.broadcastToTrip).toHaveBeenCalledTimes(1);
      expect(mockRealtime.broadcastToCompany).toHaveBeenCalledTimes(1);
    });

    it('should set actualDepartureAt when status becomes DEPARTED', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.trip.update.mockResolvedValue({ ...mockTrip, status: 'DEPARTED' });
      mockPrisma.trip.findUnique.mockResolvedValue(fullMockTrip);
      mockPrisma.booking.findMany.mockResolvedValue([]);

      await service.updateStatus('trip-1', TENANT_ID, { status: TripStatus.DEPARTED });

      const updateData = (mockPrisma.trip.update as jest.Mock).mock.calls[0][0].data;
      expect(updateData).toHaveProperty('actualDepartureAt');
    });

    it('should set actualArrivalAt when status becomes ARRIVED', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.trip.update.mockResolvedValue({ ...mockTrip, status: 'ARRIVED' });
      mockPrisma.trip.findUnique.mockResolvedValue(fullMockTrip);
      mockPrisma.booking.findMany.mockResolvedValue([]);

      await service.updateStatus('trip-1', TENANT_ID, { status: TripStatus.ARRIVED });

      const updateData = (mockPrisma.trip.update as jest.Mock).mock.calls[0][0].data;
      expect(updateData).toHaveProperty('actualArrivalAt');
    });

    it('should notify confirmed passengers with TRIP_DEPARTED and origin/destination templateData', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.trip.update.mockResolvedValue({ ...mockTrip, status: 'DEPARTED' });
      mockPrisma.trip.findUnique.mockResolvedValue(fullMockTrip);
      mockPrisma.booking.findMany.mockResolvedValue([
        { id: 'b1', passengerId: 'u1' },
        { id: 'b2', passengerId: 'u2' },
      ]);

      await service.updateStatus('trip-1', TENANT_ID, { status: TripStatus.DEPARTED });

      expect(mockNotifications.create).toHaveBeenCalledTimes(2);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.TRIP_DEPARTED,
          templateData: { origin: 'Abidjan', destination: 'Bouaké' },
          companyLogo: LOGO_URL,
        }),
      );
    });

    it('should notify confirmed passengers with TRIP_ARRIVED when status becomes ARRIVED', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.trip.update.mockResolvedValue({ ...mockTrip, status: 'ARRIVED' });
      mockPrisma.trip.findUnique.mockResolvedValue(fullMockTrip);
      mockPrisma.booking.findMany.mockResolvedValue([{ id: 'b1', passengerId: 'u1' }]);

      await service.updateStatus('trip-1', TENANT_ID, { status: TripStatus.ARRIVED });

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.TRIP_ARRIVED }),
      );
    });

    it('should notify passengers when trip is cancelled', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.trip.update.mockResolvedValue({ ...mockTrip, status: 'CANCELLED' });
      mockPrisma.trip.findUnique.mockResolvedValue(fullMockTrip);
      mockPrisma.booking.findMany.mockResolvedValue([
        { id: 'b1', passengerId: 'u1', tripId: 'trip-1', seatNumbers: ['1A'] },
        { id: 'b2', passengerId: 'u2', tripId: 'trip-1', seatNumbers: ['1B'] },
      ]);

      await service.updateStatus('trip-1', TENANT_ID, { status: TripStatus.CANCELLED });

      expect(mockNotifications.create).toHaveBeenCalledTimes(2);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.TRIP_CANCELLED,
          templateData: {},
          companyLogo: LOGO_URL,
        }),
      );
    });

    it('should notify passengers when delay is set with delayMinutes templateData', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.trip.update.mockResolvedValue({ ...mockTrip, delayMinutes: 30 });
      mockPrisma.trip.findUnique.mockResolvedValue(fullMockTrip);
      mockPrisma.booking.findMany.mockResolvedValue([{ id: 'b1', passengerId: 'u1' }]);

      await service.updateStatus('trip-1', TENANT_ID, { status: TripStatus.DELAYED, delayMinutes: 30 });

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.TRIP_DELAYED,
          templateData: expect.objectContaining({ delayMinutes: '30' }),
          companyLogo: LOGO_URL,
        }),
      );
    });

    it('should not send logo when tenant logo is a base64 data URI', async () => {
      const noLogoTrip = { ...fullMockTrip, tenant: { logo: 'data:image/png;base64,iVBOR...' } };
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.trip.update.mockResolvedValue({ ...mockTrip, status: 'CANCELLED' });
      mockPrisma.trip.findUnique.mockResolvedValue(noLogoTrip);
      mockPrisma.booking.findMany.mockResolvedValue([{ id: 'b1', passengerId: 'u1', tripId: 'trip-1', seatNumbers: ['1A'] }]);

      await service.updateStatus('trip-1', TENANT_ID, { status: TripStatus.CANCELLED });

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ companyLogo: undefined }),
      );
    });

    it('should throw NotFoundException for unknown trip', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(null);
      await expect(
        service.updateStatus('nonexistent', TENANT_ID, { status: TripStatus.BOARDING }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── toggleSeatBlock ───────────────────────────────────────────────────────────

  describe('toggleSeatBlock', () => {
    it('should block an available seat', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      const seat = { id: 's1', tripId: 'trip-1', seatNumber: '1A', status: 'AVAILABLE' };
      mockPrisma.tripSeat.findUnique.mockResolvedValue(seat);
      mockPrisma.tripSeat.update.mockResolvedValue({ ...seat, status: 'BLOCKED' });

      const result = await service.toggleSeatBlock('trip-1', TENANT_ID, '1A');

      expect(result.status).toBe('BLOCKED');
      expect(mockRealtime.broadcastToTrip).toHaveBeenCalledWith(
        'trip-1',
        'seat:updated',
        expect.objectContaining({ seatNumber: '1A', status: 'BLOCKED' }),
      );
    });

    it('should unblock a blocked seat', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      const seat = { id: 's1', tripId: 'trip-1', seatNumber: '1A', status: 'BLOCKED' };
      mockPrisma.tripSeat.findUnique.mockResolvedValue(seat);
      mockPrisma.tripSeat.update.mockResolvedValue({ ...seat, status: 'AVAILABLE' });

      const result = await service.toggleSeatBlock('trip-1', TENANT_ID, '1A');

      expect(result.status).toBe('AVAILABLE');
    });

    it('should throw BadRequestException for a reserved seat', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.tripSeat.findUnique.mockResolvedValue({
        id: 's1', tripId: 'trip-1', seatNumber: '1A', status: 'RESERVED',
      });

      await expect(service.toggleSeatBlock('trip-1', TENANT_ID, '1A')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for an occupied seat', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.tripSeat.findUnique.mockResolvedValue({
        id: 's1', tripId: 'trip-1', seatNumber: '1A', status: 'OCCUPIED',
      });

      await expect(service.toggleSeatBlock('trip-1', TENANT_ID, '1A')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for unknown trip', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(null);
      await expect(service.toggleSeatBlock('nonexistent', TENANT_ID, '1A')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for unknown seat', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(mockTrip);
      mockPrisma.tripSeat.findUnique.mockResolvedValue(null);
      await expect(service.toggleSeatBlock('trip-1', TENANT_ID, 'Z9')).rejects.toThrow(NotFoundException);
    });
  });

  // ── search ────────────────────────────────────────────────────────────────────

  describe('search', () => {
    const dto = {
      origin: 'Abidjan',
      destination: 'Bouaké',
      departureDate: '2025-06-01',
      passengers: 2,
    };

    it('should return available trips matching the search criteria', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([mockTrip]);

      const result = await service.search(dto);

      expect(result).toHaveLength(1);
      const where = (mockPrisma.trip.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['SCHEDULED', 'BOARDING'] });
      expect(where.availableSeats).toEqual({ gte: 2 });
    });

    it('should filter by tripClass when provided', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([]);

      await service.search({ ...dto, tripClass: 'VIP' as any });

      const where = (mockPrisma.trip.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.tripClass).toBe('VIP');
    });

    it('should default to 1 passenger when passengers not provided', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([]);
      const { passengers: _, ...dtoWithout } = dto;

      await service.search(dtoWithout as any);

      const where = (mockPrisma.trip.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.availableSeats).toEqual({ gte: 1 });
    });
  });
});
