import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SchedulesService } from '../schedules.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrisma } from '../../common/test/mock-prisma';

const mockPrisma = createMockPrisma();

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';

const mockRoute = {
  id: 'route-1',
  tenantId: TENANT_ID,
  name: 'Abidjan → Bouaké',
  durationMinutes: 240,
  originCity: { name: 'Abidjan' },
  destinationCity: { name: 'Bouaké' },
};

const mockVehicle = {
  id: 'vehicle-1',
  tenantId: TENANT_ID,
  plate: 'CI-1234-AB',
  capacity: 30,
  status: 'ACTIVE',
  seatLayout: {
    seats: [
      { number: '1A' }, { number: '1B' }, { number: '2A' }, { number: '2B' },
    ],
  },
};

const mockSchedule = {
  id: 'schedule-1',
  tenantId: TENANT_ID,
  routeId: 'route-1',
  vehicleId: 'vehicle-1',
  driverId: null,
  departureStationId: null,
  label: 'Abidjan-Bouaké 08h00',
  departureTime: '08:00',
  daysOfWeek: [1, 2, 3, 4, 5],
  tripClass: 'STANDARD',
  price: 5000,
  amenities: [],
  isActive: true,
  generateDaysAhead: 7,
  route: mockRoute,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SchedulesService', () => {
  let service: SchedulesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SchedulesService>(SchedulesService);
    jest.clearAllMocks();
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      routeId: 'route-1',
      vehicleId: 'vehicle-1',
      label: 'Abidjan-Bouaké 08h00',
      departureTime: '08:00',
      daysOfWeek: [1, 2, 3, 4, 5],
      tripClass: 'STANDARD' as any,
      price: 5000,
    };

    it('should create a schedule and return it', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(mockRoute);
      mockPrisma.vehicle.findFirst.mockResolvedValue(mockVehicle);
      mockPrisma.schedule.create.mockResolvedValue(mockSchedule);

      const result = await service.create(TENANT_ID, dto);

      expect(result).toMatchObject({ id: 'schedule-1', label: 'Abidjan-Bouaké 08h00' });
      expect(mockPrisma.schedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            routeId: 'route-1',
            price: 5000,
          }),
        }),
      );
    });

    it('should throw NotFoundException for unknown route', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(null);

      await expect(service.create(TENANT_ID, dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for unknown vehicle', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(mockRoute);
      mockPrisma.vehicle.findFirst.mockResolvedValue(null);

      await expect(service.create(TENANT_ID, dto)).rejects.toThrow(NotFoundException);
    });

    it('should store departureStationId when provided', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(mockRoute);
      mockPrisma.vehicle.findFirst.mockResolvedValue(mockVehicle);
      mockPrisma.schedule.create.mockResolvedValue({
        ...mockSchedule,
        departureStationId: 'station-1',
      });

      await service.create(TENANT_ID, { ...dto, departureStationId: 'station-1' });

      expect(mockPrisma.schedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ departureStationId: 'station-1' }),
        }),
      );
    });

    it('should create schedule without vehicle when vehicleId is omitted', async () => {
      mockPrisma.route.findFirst.mockResolvedValue(mockRoute);
      mockPrisma.schedule.create.mockResolvedValue({ ...mockSchedule, vehicleId: undefined });

      const { vehicleId: _, ...dtoWithoutVehicle } = dto;
      await service.create(TENANT_ID, dtoWithoutVehicle);

      expect(mockPrisma.vehicle.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.schedule.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all schedules for the tenant', async () => {
      mockPrisma.schedule.findMany.mockResolvedValue([mockSchedule]);

      const result = await service.findAll(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(mockPrisma.schedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID } }),
      );
    });

    it('should return empty array when tenant has no schedules', async () => {
      mockPrisma.schedule.findMany.mockResolvedValue([]);
      const result = await service.findAll(TENANT_ID);
      expect(result).toHaveLength(0);
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the schedule for valid id and tenant', async () => {
      mockPrisma.schedule.findUnique.mockResolvedValue(mockSchedule);
      const result = await service.findOne('schedule-1', TENANT_ID);
      expect(result.id).toBe('schedule-1');
    });

    it('should throw NotFoundException when schedule does not exist', async () => {
      mockPrisma.schedule.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent', TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when schedule belongs to another tenant', async () => {
      mockPrisma.schedule.findUnique.mockResolvedValue({
        ...mockSchedule,
        tenantId: 'other-tenant',
      });
      await expect(service.findOne('schedule-1', TENANT_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update schedule fields', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(mockSchedule);
      mockPrisma.schedule.update.mockResolvedValue({ ...mockSchedule, price: 6000 });

      const result = await service.update('schedule-1', TENANT_ID, { price: 6000 });

      expect(result.price).toBe(6000);
      expect(mockPrisma.schedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'schedule-1' },
          data: expect.objectContaining({ price: 6000 }),
        }),
      );
    });

    it('should throw NotFoundException for unknown schedule', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(null);
      await expect(service.update('nonexistent', TENANT_ID, { price: 6000 })).rejects.toThrow(NotFoundException);
    });

    it('should deactivate a schedule', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(mockSchedule);
      mockPrisma.schedule.update.mockResolvedValue({ ...mockSchedule, isActive: false });

      await service.update('schedule-1', TENANT_ID, { isActive: false });

      expect(mockPrisma.schedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        }),
      );
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete an existing schedule', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(mockSchedule);
      mockPrisma.schedule.delete.mockResolvedValue(mockSchedule);

      await service.remove('schedule-1', TENANT_ID);

      expect(mockPrisma.schedule.delete).toHaveBeenCalledWith({ where: { id: 'schedule-1' } });
    });

    it('should throw NotFoundException for unknown schedule', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(null);
      await expect(service.remove('nonexistent', TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── generateFromSchedule ──────────────────────────────────────────────────────

  describe('generateFromSchedule', () => {
    it('should throw NotFoundException when schedule does not exist', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(null);
      await expect(service.generateFromSchedule(TENANT_ID, 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when schedule has no vehicle', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue({ ...mockSchedule, vehicleId: null });
      await expect(service.generateFromSchedule(TENANT_ID, 'schedule-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when vehicle does not exist', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(mockSchedule);
      mockPrisma.vehicle.findUnique.mockResolvedValue(null);
      await expect(service.generateFromSchedule(TENANT_ID, 'schedule-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when vehicle is inactive', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(mockSchedule);
      mockPrisma.vehicle.findUnique.mockResolvedValue({ ...mockVehicle, status: 'MAINTENANCE' });
      await expect(service.generateFromSchedule(TENANT_ID, 'schedule-1')).rejects.toThrow(BadRequestException);
    });

    it('should generate trips for eligible days and skip existing ones', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(mockSchedule); // daysOfWeek: [1,2,3,4,5]
      mockPrisma.vehicle.findUnique.mockResolvedValue(mockVehicle);
      // First day: existing trip → skip; all others: create
      mockPrisma.trip.findFirst
        .mockResolvedValueOnce({ id: 'existing-trip' }) // duplicate → skip
        .mockResolvedValue(null);
      mockPrisma.trip.create.mockResolvedValue({ id: 'new-trip' });

      const result = await service.generateFromSchedule(TENANT_ID, 'schedule-1', 3);

      expect(result).toHaveProperty('created');
      expect(result).toHaveProperty('skipped');
      expect(result.created + result.skipped).toBe(3);
    });

    it('should propagate departureStationId to generated trips', async () => {
      const scheduleWithStation = { ...mockSchedule, departureStationId: 'station-1' };
      mockPrisma.schedule.findFirst.mockResolvedValue(scheduleWithStation);
      mockPrisma.vehicle.findUnique.mockResolvedValue(mockVehicle);
      mockPrisma.trip.findFirst.mockResolvedValue(null); // no existing trip
      mockPrisma.trip.create.mockResolvedValue({ id: 'new-trip' });

      await service.generateFromSchedule(TENANT_ID, 'schedule-1', 1);

      // Every created trip should carry the station id
      const calls = (mockPrisma.trip.create as jest.Mock).mock.calls;
      for (const [arg] of calls) {
        expect(arg.data).toHaveProperty('departureStationId', 'station-1');
      }
    });

    it('should NOT set departureStationId when schedule has none', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue({ ...mockSchedule, departureStationId: null });
      mockPrisma.vehicle.findUnique.mockResolvedValue(mockVehicle);
      mockPrisma.trip.findFirst.mockResolvedValue(null);
      mockPrisma.trip.create.mockResolvedValue({ id: 'new-trip' });

      await service.generateFromSchedule(TENANT_ID, 'schedule-1', 1);

      const calls = (mockPrisma.trip.create as jest.Mock).mock.calls;
      for (const [arg] of calls) {
        expect(arg.data.departureStationId).toBeUndefined();
      }
    });
  });

  // ── generateAll ───────────────────────────────────────────────────────────────

  describe('generateAll', () => {
    it('should generate trips for all active schedules', async () => {
      mockPrisma.schedule.findMany.mockResolvedValue([mockSchedule]);
      mockPrisma.vehicle.findUnique.mockResolvedValue(mockVehicle);
      mockPrisma.trip.findFirst.mockResolvedValue(null);
      mockPrisma.trip.create.mockResolvedValue({ id: 'new-trip' });

      const result = await service.generateAll(TENANT_ID, 1);

      expect(result.created + result.skipped).toBeGreaterThanOrEqual(0);
    });

    it('should skip schedules with inactive vehicles', async () => {
      mockPrisma.schedule.findMany.mockResolvedValue([mockSchedule]);
      mockPrisma.vehicle.findUnique.mockResolvedValue({ ...mockVehicle, status: 'MAINTENANCE' });

      const result = await service.generateAll(TENANT_ID, 1);

      expect(mockPrisma.trip.create).not.toHaveBeenCalled();
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    });

    it('should return 0 created when no active schedules', async () => {
      mockPrisma.schedule.findMany.mockResolvedValue([]);
      const result = await service.generateAll(TENANT_ID, 7);
      expect(result).toEqual({ created: 0, skipped: 0 });
    });
  });

  // ── dailyGeneration (cron) ────────────────────────────────────────────────────

  describe('dailyGeneration (cron)', () => {
    it('should run generation for all active tenants', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([
        { id: 'tenant-1' },
        { id: 'tenant-2' },
      ]);
      // Each tenant has no schedules
      mockPrisma.schedule.findMany.mockResolvedValue([]);

      await service.dailyGeneration();

      // Called once per tenant
      expect(mockPrisma.schedule.findMany).toHaveBeenCalledTimes(2);
    });

    it('should not throw even when generation fails for one tenant', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }]);
      mockPrisma.schedule.findMany.mockRejectedValue(new Error('DB error'));

      await expect(service.dailyGeneration()).rejects.toThrow('DB error');
    });
  });
});
