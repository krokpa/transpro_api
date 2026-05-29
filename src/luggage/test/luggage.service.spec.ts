import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LuggageService } from '../luggage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrisma } from '../../common/test/mock-prisma';

jest.mock('@transpro/shared', () => ({
  ...jest.requireActual('@transpro/shared'),
  generateReference: () => 'LG-MOCK',
}));

const mockPrisma = createMockPrisma();

const TENANT_ID  = 'tenant-1';
const AGENT_ID   = 'agent-1';
const BOOKING_ID = 'booking-1';
const TRIP_ID    = 'trip-1';
const LUGGAGE_ID = 'luggage-1';
const BAG_ID     = 'bag-1';
const QR_CODE    = 'LG-MOCK';

const mockConfirmedBooking = {
  id: BOOKING_ID,
  tripId: TRIP_ID,
  status: 'CONFIRMED',
};

const mockLuggage = {
  id: LUGGAGE_ID,
  bookingId: BOOKING_ID,
  tripId: TRIP_ID,
  tenantId: TENANT_ID,
  bagCount: 2,
  totalWeightKg: 25,
  freeWeightKg: 20,
  excessWeightKg: 5,
  excessFeeXof: 1500,
  excessPaid: false,
  excessPaymentMethod: null,
  agentId: AGENT_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
  agent: { id: AGENT_ID, firstName: 'Awa', lastName: 'Diallo' },
  bags: [],
  booking: {
    id: BOOKING_ID,
    reference: 'TP-0001',
    seatNumbers: ['1A'],
    passenger: { id: 'user-1', firstName: 'Koffi', lastName: 'Yao', phone: '+225 07' },
  },
};

const mockBag = (status = 'DECLARED') => ({
  id: BAG_ID,
  luggageId: LUGGAGE_ID,
  qrCode: QR_CODE,
  label: null,
  weightKg: null,
  status,
  loadedAt: null,
  arrivedAt: null,
  claimedAt: null,
  missingAt: null,
  missingNote: null,
  createdAt: new Date(),
  luggage: {
    tenantId: TENANT_ID,
    booking: {
      reference: 'TP-0001',
      passenger: { firstName: 'Koffi', lastName: 'Yao' },
      seatNumbers: ['1A'],
    },
  },
});

describe('LuggageService', () => {
  let service: LuggageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LuggageService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LuggageService>(LuggageService);
    jest.clearAllMocks();
  });

  // ── declare ───────────────────────────────────────────────────────────────────

  describe('declare', () => {
    const dto = { bookingId: BOOKING_ID, bagCount: 2, totalWeightKg: 25 };

    it('should create a new luggage declaration with bags', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue(mockConfirmedBooking);
      mockPrisma.bookingLuggage.findUnique.mockResolvedValue(null);
      mockPrisma.bookingLuggage.create.mockResolvedValue({ id: LUGGAGE_ID });
      mockPrisma.luggageBag.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.bookingLuggage.findUnique.mockResolvedValueOnce(null).mockResolvedValue(mockLuggage);

      const result = await service.declare(TENANT_ID, AGENT_ID, dto);

      expect(mockPrisma.bookingLuggage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bookingId: BOOKING_ID,
            tenantId: TENANT_ID,
            agentId: AGENT_ID,
            bagCount: 2,
            excessWeightKg: 5,
            excessFeeXof: 1500,
          }),
        }),
      );
      expect(mockPrisma.luggageBag.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ luggageId: LUGGAGE_ID, qrCode: 'LG-MOCK' }),
          ]),
        }),
      );
      expect(result).toBeDefined();
    });

    it('should update an existing declaration and remove only DECLARED bags', async () => {
      const existingWithBags = {
        id: LUGGAGE_ID,
        bags: [
          { id: 'bag-declared', status: 'DECLARED' },
          { id: 'bag-loaded',   status: 'LOADED'   },
        ],
      };
      mockPrisma.booking.findFirst.mockResolvedValue(mockConfirmedBooking);
      mockPrisma.bookingLuggage.findUnique
        .mockResolvedValueOnce(existingWithBags)
        .mockResolvedValue(mockLuggage);
      mockPrisma.luggageBag.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.bookingLuggage.update.mockResolvedValue({});
      mockPrisma.luggageBag.createMany.mockResolvedValue({ count: 2 });

      await service.declare(TENANT_ID, AGENT_ID, dto);

      expect(mockPrisma.luggageBag.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['bag-declared'] } },
      });
      expect(mockPrisma.luggageBag.deleteMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: expect.arrayContaining(['bag-loaded']) } } }),
      );
      expect(mockPrisma.bookingLuggage.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: LUGGAGE_ID } }),
      );
    });

    it('should not call deleteMany when all existing bags are not DECLARED', async () => {
      const existingNoDeclared = {
        id: LUGGAGE_ID,
        bags: [{ id: 'bag-loaded', status: 'LOADED' }],
      };
      mockPrisma.booking.findFirst.mockResolvedValue(mockConfirmedBooking);
      mockPrisma.bookingLuggage.findUnique
        .mockResolvedValueOnce(existingNoDeclared)
        .mockResolvedValue(mockLuggage);
      mockPrisma.bookingLuggage.update.mockResolvedValue({});
      mockPrisma.luggageBag.createMany.mockResolvedValue({ count: 2 });

      await service.declare(TENANT_ID, AGENT_ID, dto);

      expect(mockPrisma.luggageBag.deleteMany).not.toHaveBeenCalled();
    });

    it('should calculate zero excess fee when totalWeightKg <= freeWeightKg', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue(mockConfirmedBooking);
      mockPrisma.bookingLuggage.findUnique.mockResolvedValueOnce(null).mockResolvedValue(mockLuggage);
      mockPrisma.bookingLuggage.create.mockResolvedValue({ id: LUGGAGE_ID });
      mockPrisma.luggageBag.createMany.mockResolvedValue({ count: 1 });

      await service.declare(TENANT_ID, AGENT_ID, {
        bookingId: BOOKING_ID,
        bagCount: 1,
        totalWeightKg: 15,   // < 20 kg free
        freeWeightKg: 20,
      });

      expect(mockPrisma.bookingLuggage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ excessWeightKg: 0, excessFeeXof: 0 }),
        }),
      );
    });

    it('should not call createMany when bagCount is 0', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue(mockConfirmedBooking);
      mockPrisma.bookingLuggage.findUnique.mockResolvedValueOnce(null).mockResolvedValue(mockLuggage);
      mockPrisma.bookingLuggage.create.mockResolvedValue({ id: LUGGAGE_ID });

      await service.declare(TENANT_ID, AGENT_ID, { bookingId: BOOKING_ID, bagCount: 0 });

      expect(mockPrisma.luggageBag.createMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when booking not found', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue(null);

      await expect(service.declare(TENANT_ID, AGENT_ID, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when booking status is CANCELLED', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue({ ...mockConfirmedBooking, status: 'CANCELLED' });

      await expect(service.declare(TENANT_ID, AGENT_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when booking status is COMPLETED', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue({ ...mockConfirmedBooking, status: 'COMPLETED' });

      await expect(service.declare(TENANT_ID, AGENT_ID, dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ── getByBooking ──────────────────────────────────────────────────────────────

  describe('getByBooking', () => {
    it('should return luggage for a valid booking', async () => {
      mockPrisma.bookingLuggage.findFirst.mockResolvedValue(mockLuggage);

      const result = await service.getByBooking(BOOKING_ID, TENANT_ID);

      expect(result).toEqual(mockLuggage);
      expect(mockPrisma.bookingLuggage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { bookingId: BOOKING_ID, tenantId: TENANT_ID } }),
      );
    });

    it('should throw NotFoundException when no luggage exists for booking', async () => {
      mockPrisma.bookingLuggage.findFirst.mockResolvedValue(null);

      await expect(service.getByBooking(BOOKING_ID, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── getByBookingPublic ────────────────────────────────────────────────────────

  describe('getByBookingPublic', () => {
    it('should return luggage or null without tenant check', async () => {
      mockPrisma.bookingLuggage.findUnique.mockResolvedValue(mockLuggage);

      const result = await service.getByBookingPublic(BOOKING_ID);

      expect(result).toEqual(mockLuggage);
    });

    it('should return null when booking has no luggage', async () => {
      mockPrisma.bookingLuggage.findUnique.mockResolvedValue(null);

      const result = await service.getByBookingPublic(BOOKING_ID);

      expect(result).toBeNull();
    });
  });

  // ── getByTrip ─────────────────────────────────────────────────────────────────

  describe('getByTrip', () => {
    it('should return all luggage declarations for a trip', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue({ id: TRIP_ID });
      mockPrisma.bookingLuggage.findMany.mockResolvedValue([mockLuggage]);

      const result = await service.getByTrip(TRIP_ID, TENANT_ID);

      expect(result).toHaveLength(1);
      expect(mockPrisma.bookingLuggage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tripId: TRIP_ID, tenantId: TENANT_ID } }),
      );
    });

    it('should throw NotFoundException when trip not found', async () => {
      mockPrisma.trip.findFirst.mockResolvedValue(null);

      await expect(service.getByTrip(TRIP_ID, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── scanBag ───────────────────────────────────────────────────────────────────

  describe('scanBag', () => {
    it('should transition DECLARED → LOADED on first scan', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(mockBag('DECLARED'));
      mockPrisma.luggageBag.update.mockResolvedValue({ ...mockBag('LOADED'), loadedAt: new Date() });

      const result = await service.scanBag(QR_CODE, TENANT_ID);

      expect(mockPrisma.luggageBag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'LOADED' }),
        }),
      );
      expect(result.bag).toBeDefined();
    });

    it('should transition LOADED → ARRIVED on second scan', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(mockBag('LOADED'));
      mockPrisma.luggageBag.update.mockResolvedValue({ ...mockBag('ARRIVED'), arrivedAt: new Date() });

      const result = await service.scanBag(QR_CODE, TENANT_ID);

      expect(mockPrisma.luggageBag.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ARRIVED' }) }),
      );
      expect(result.booking).toBeDefined();
    });

    it('should transition ARRIVED → CLAIMED on third scan', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(mockBag('ARRIVED'));
      mockPrisma.luggageBag.update.mockResolvedValue({ ...mockBag('CLAIMED'), claimedAt: new Date() });

      await service.scanBag(QR_CODE, TENANT_ID);

      expect(mockPrisma.luggageBag.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CLAIMED' }) }),
      );
    });

    it('should throw NotFoundException for unknown QR code', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(null);

      await expect(service.scanBag('INVALID', TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when bag belongs to another tenant', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue({
        ...mockBag('DECLARED'),
        luggage: { ...mockBag('DECLARED').luggage, tenantId: 'other-tenant' },
      });

      await expect(service.scanBag(QR_CODE, TENANT_ID)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when bag is already CLAIMED', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(mockBag('CLAIMED'));

      await expect(service.scanBag(QR_CODE, TENANT_ID)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when bag is MISSING', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(mockBag('MISSING'));

      await expect(service.scanBag(QR_CODE, TENANT_ID)).rejects.toThrow(BadRequestException);
    });
  });

  // ── reportMissing ─────────────────────────────────────────────────────────────

  describe('reportMissing', () => {
    it('should mark a bag as MISSING with a note', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(
        mockBag('LOADED'),
      );
      mockPrisma.luggageBag.update.mockResolvedValue({
        ...mockBag('MISSING'),
        missingAt: new Date(),
        missingNote: 'Perdu à Bouaké',
      });

      const result = await service.reportMissing(BAG_ID, TENANT_ID, { note: 'Perdu à Bouaké' });

      expect(mockPrisma.luggageBag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BAG_ID },
          data: expect.objectContaining({ status: 'MISSING', missingNote: 'Perdu à Bouaké' }),
        }),
      );
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException when bag not found', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(null);

      await expect(service.reportMissing(BAG_ID, TENANT_ID, {})).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when bag belongs to another tenant', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue({
        ...mockBag('LOADED'),
        luggage: { tenantId: 'other-tenant' },
      });

      await expect(service.reportMissing(BAG_ID, TENANT_ID, {})).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when bag is already CLAIMED', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(mockBag('CLAIMED'));

      await expect(service.reportMissing(BAG_ID, TENANT_ID, {})).rejects.toThrow(ConflictException);
    });
  });

  // ── reportMissingByQr ─────────────────────────────────────────────────────────

  describe('reportMissingByQr', () => {
    it('should resolve bag by QR code and delegate to reportMissing', async () => {
      mockPrisma.luggageBag.findUnique
        .mockResolvedValueOnce({ id: BAG_ID, luggage: { tenantId: TENANT_ID } })  // findUnique by qrCode
        .mockResolvedValueOnce(mockBag('LOADED'));                                  // findUnique inside reportMissing
      mockPrisma.luggageBag.update.mockResolvedValue(mockBag('MISSING'));

      await service.reportMissingByQr(QR_CODE, { note: 'Introuvable' });

      expect(mockPrisma.luggageBag.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'MISSING' }) }),
      );
    });

    it('should throw NotFoundException for unknown QR code', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(null);

      await expect(service.reportMissingByQr('INVALID', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all luggage for a tenant', async () => {
      mockPrisma.bookingLuggage.findMany.mockResolvedValue([mockLuggage]);

      const result = await service.findAll(TENANT_ID, {});

      expect(result).toHaveLength(1);
      expect(mockPrisma.bookingLuggage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID } }),
      );
    });

    it('should filter by tripId when provided', async () => {
      mockPrisma.bookingLuggage.findMany.mockResolvedValue([mockLuggage]);

      await service.findAll(TENANT_ID, { tripId: TRIP_ID });

      expect(mockPrisma.bookingLuggage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID, tripId: TRIP_ID } }),
      );
    });

    it('should filter by bag status when provided', async () => {
      mockPrisma.bookingLuggage.findMany.mockResolvedValue([mockLuggage]);

      await service.findAll(TENANT_ID, { status: 'LOADED' });

      expect(mockPrisma.bookingLuggage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ bags: { some: { status: 'LOADED' } } }),
        }),
      );
    });

    it('should return empty array when no luggage found', async () => {
      mockPrisma.bookingLuggage.findMany.mockResolvedValue([]);

      const result = await service.findAll(TENANT_ID, {});

      expect(result).toHaveLength(0);
    });
  });

  // ── addBagPhotos ──────────────────────────────────────────────────────────────

  describe('addBagPhotos', () => {
    const photos = ['data:image/jpeg;base64,/9j/photo1', 'data:image/jpeg;base64,/9j/photo2'];

    it('should save up to 2 photos on a bag and return updated bag', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(mockBag('DECLARED'));
      mockPrisma.luggageBag.update.mockResolvedValue({ ...mockBag('DECLARED'), photos });

      const result = await service.addBagPhotos(BAG_ID, TENANT_ID, { photos });

      expect(mockPrisma.luggageBag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BAG_ID },
          data: { photos },
        }),
      );
      expect(result).toBeDefined();
    });

    it('should allow clearing all photos with an empty array', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue({ ...mockBag('LOADED'), photos });
      mockPrisma.luggageBag.update.mockResolvedValue({ ...mockBag('LOADED'), photos: [] });

      await service.addBagPhotos(BAG_ID, TENANT_ID, { photos: [] });

      expect(mockPrisma.luggageBag.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { photos: [] } }),
      );
    });

    it('should throw BadRequestException when more than 2 photos are provided', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(mockBag('DECLARED'));

      await expect(
        service.addBagPhotos(BAG_ID, TENANT_ID, {
          photos: [...photos, 'data:image/jpeg;base64,extra'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when bag does not exist', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue(null);

      await expect(
        service.addBagPhotos('nonexistent', TENANT_ID, { photos }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when bag belongs to another tenant', async () => {
      mockPrisma.luggageBag.findUnique.mockResolvedValue({
        ...mockBag('DECLARED'),
        luggage: { tenantId: 'other-tenant' },
      });

      await expect(
        service.addBagPhotos(BAG_ID, TENANT_ID, { photos }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
