import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpensesService } from '../expenses.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StationCashPeriodsService } from '../../station-cash-periods/station-cash-periods.service';
import { createMockPrisma } from '../../common/test/mock-prisma';

const mockCashPeriods = { recalculate: jest.fn().mockResolvedValue(undefined) };

const mockPrisma = createMockPrisma();

const TENANT_ID  = 'tenant-abc';
const STATION_ID = 'station-001';
const USER_ID    = 'user-001';

const mockUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  role: 'COMPANY_ADMIN',
  stationIds: [STATION_ID],
};

const mockStation = { id: STATION_ID, tenantId: TENANT_ID, name: 'Gare d\'Adjamé' };

const mockExpense = {
  id: 'exp-001',
  tenantId:      TENANT_ID,
  stationId:     STATION_ID,
  category:      'FUEL',
  description:   'Achat gasoil',
  amount:        15000,
  date:          new Date('2026-06-01'),
  status:        'SUBMITTED',
  submittedById: USER_ID,
  receiptNote:   null,
  approvedById:  null,
  approvedAt:    null,
  rejectedAt:    null,
  rejectedReason: null,
};

describe('ExpensesService', () => {
  let service: ExpensesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService,              useValue: mockPrisma      },
        { provide: StationCashPeriodsService,  useValue: mockCashPeriods },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
    jest.clearAllMocks();
  });

  // ── create ───────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      stationId: STATION_ID, category: 'FUEL',
      description: 'Achat gasoil', amount: 15000, date: '2026-06-01',
    };

    it('should create an expense when station belongs to tenant', async () => {
      mockPrisma.station.findFirst.mockResolvedValue(mockStation);
      mockPrisma.expense.create.mockResolvedValue({ ...mockExpense, station: mockStation, submitter: { firstName: 'Yves', lastName: 'K' } });

      const result = await service.create(dto as any, mockUser);

      expect(result.status).toBe('SUBMITTED');
      expect(result.amount).toBe(15000);
      expect(mockPrisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID, stationId: STATION_ID, status: 'SUBMITTED' }),
        }),
      );
    });

    it('should throw NotFoundException when station not found', async () => {
      mockPrisma.station.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, mockUser)).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all tenant expenses without filters', async () => {
      mockPrisma.expense.findMany.mockResolvedValue([mockExpense]);
      const result = await service.findAll(mockUser, {});
      expect(result).toHaveLength(1);
      expect(mockPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID }) }),
      );
    });

    it('should filter by station for COMPANY_AGENT role', async () => {
      const agentUser = { ...mockUser, role: 'COMPANY_AGENT', stationIds: [STATION_ID] };
      mockPrisma.expense.findMany.mockResolvedValue([]);

      await service.findAll(agentUser, {});

      expect(mockPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stationId: { in: [STATION_ID] } }),
        }),
      );
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return expense for same tenant', async () => {
      mockPrisma.expense.findUnique.mockResolvedValue(mockExpense);
      const result = await service.findOne('exp-001', mockUser);
      expect(result.id).toBe('exp-001');
    });

    it('should throw NotFoundException when expense not found', async () => {
      mockPrisma.expense.findUnique.mockResolvedValue(null);
      await expect(service.findOne('not-found', mockUser)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when tenant mismatch', async () => {
      mockPrisma.expense.findUnique.mockResolvedValue({ ...mockExpense, tenantId: 'other-tenant' });
      await expect(service.findOne('exp-001', mockUser)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── approve ──────────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('should transition SUBMITTED → APPROVED', async () => {
      mockPrisma.expense.findUnique.mockResolvedValue(mockExpense);
      mockPrisma.expense.update.mockResolvedValue({ ...mockExpense, status: 'APPROVED', approvedById: USER_ID });

      const result = await service.approve('exp-001', mockUser);

      expect(result.status).toBe('APPROVED');
      expect(mockPrisma.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED', approvedById: USER_ID }),
        }),
      );
    });

    it('should throw BadRequestException when already APPROVED', async () => {
      mockPrisma.expense.findUnique.mockResolvedValue({ ...mockExpense, status: 'APPROVED' });
      await expect(service.approve('exp-001', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  // ── reject ───────────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('should transition SUBMITTED → REJECTED with reason', async () => {
      mockPrisma.expense.findUnique.mockResolvedValue(mockExpense);
      mockPrisma.expense.update.mockResolvedValue({ ...mockExpense, status: 'REJECTED', rejectedReason: 'Reçu absent' });

      const result = await service.reject('exp-001', 'Reçu absent', mockUser);

      expect(result.status).toBe('REJECTED');
      expect(mockPrisma.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED', rejectedReason: 'Reçu absent' }),
        }),
      );
    });

    it('should throw BadRequestException when status is not SUBMITTED', async () => {
      mockPrisma.expense.findUnique.mockResolvedValue({ ...mockExpense, status: 'APPROVED' });
      await expect(service.reject('exp-001', 'reason', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  // ── stationSummary ───────────────────────────────────────────────────────────

  describe('stationSummary', () => {
    it('should compute balance: cashSales + provisions - approvedExpenses', async () => {
      mockPrisma.expense.findMany.mockResolvedValue([
        { ...mockExpense, status: 'APPROVED', amount: 10000, category: 'FUEL' },
        { ...mockExpense, status: 'SUBMITTED', amount: 5000, category: 'MEAL' },
      ]);
      mockPrisma.cashProvision.findMany.mockResolvedValue([{ id: 'prov-1', amount: 50000, status: 'RECEIVED' }]);
      mockPrisma.booking.findMany.mockResolvedValue([
        { payment: { method: 'CASH', status: 'SUCCESS', amount: 25000 } },
        { payment: { method: 'GENIUS_PAY', status: 'SUCCESS', amount: 15000 } },
      ]);

      const result = await service.stationSummary(STATION_ID, TENANT_ID, '2026-06');

      expect(result.cashSales).toBe(25000);
      expect(result.totalExpenses).toBe(10000);
      expect(result.totalProvisions).toBe(50000);
      expect(result.pendingExpenses).toBe(5000);
      expect(result.estimatedBalance).toBe(25000 + 50000 - 10000);
      expect(result.byCategory).toEqual({ FUEL: 10000 });
    });
  });
});
