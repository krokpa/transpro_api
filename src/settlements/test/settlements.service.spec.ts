import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SettlementsService } from '../settlements.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';
import { createMockPrisma } from '../../common/test/mock-prisma';

const mockPrisma = createMockPrisma();
const mockEmail  = {
  sendSettlementPaid:   jest.fn().mockResolvedValue(undefined),
  sendSettlementFailed: jest.fn().mockResolvedValue(undefined),
};
const mockConfig = { get: jest.fn((key: string, def?: any) => {
  const map: Record<string, string> = { FRONTEND_URL: 'https://app.transpro.ci' };
  return map[key] ?? def ?? '';
}) };

const TENANT_ID = 'tenant-001';
const ADMIN_ID  = 'admin-001';

const mockSettlementPending = {
  id:           'sett-001',
  tenantId:     TENANT_ID,
  periodStart:  new Date('2026-05-01'),
  periodEnd:    new Date('2026-05-31'),
  status:       'PENDING',
  totalAmount:  200000,
  geniusPayFees: 2000,
  commissions:  8000,
  netAmount:    190000,
  currency:     'XOF',
  itemCount:    4,
  bankName:     null,
  bankAccount:  null,
  transferRef:  null,
  notes:        null,
  processedById: null,
  processedAt:  null,
};

const mockSettlementProcessing = { ...mockSettlementPending, status: 'PROCESSING' };

describe('SettlementsService', () => {
  let service: SettlementsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementsService,
        { provide: PrismaService,  useValue: mockPrisma  },
        { provide: EmailService,   useValue: mockEmail   },
        { provide: ConfigService,  useValue: mockConfig  },
      ],
    }).compile();

    service = module.get<SettlementsService>(SettlementsService);
    jest.clearAllMocks();
  });

  // ── computeForTenant ─────────────────────────────────────────────────────────

  describe('computeForTenant', () => {
    const start = new Date('2026-05-01');
    const end   = new Date('2026-05-31');

    it('should create settlement + items for unsettled payments', async () => {
      const payments = [
        { id: 'pay-1', amount: 100000, geniusPayFee: 1000, commissionAmount: 4000, netAmount: 95000 },
        { id: 'pay-2', amount:  80000, geniusPayFee:  800, commissionAmount: 3200, netAmount: 76000 },
      ];
      mockPrisma.payment.findMany.mockResolvedValue(payments);
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
      mockPrisma.settlement.create.mockResolvedValue({ ...mockSettlementPending, id: 'sett-new' });
      mockPrisma.settlementItem.createMany.mockResolvedValue({ count: 2 });

      const result = await service.computeForTenant(TENANT_ID, start, end);

      expect(result?.id).toBe('sett-new');
      expect(mockPrisma.settlement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId:   TENANT_ID,
            totalAmount: 180000,
            netAmount:   171000,
            itemCount:   2,
            status:      'PENDING',
          }),
        }),
      );
      expect(mockPrisma.settlementItem.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([
          expect.objectContaining({ paymentId: 'pay-1', amount: 100000 }),
        ]) }),
      );
    });

    it('should return null when no unsettled payments', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      const result = await service.computeForTenant(TENANT_ID, start, end);
      expect(result).toBeNull();
      expect(mockPrisma.settlement.create).not.toHaveBeenCalled();
    });
  });

  // ── markProcessing ────────────────────────────────────────────────────────────

  describe('markProcessing', () => {
    it('should transition PENDING → PROCESSING', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue(mockSettlementPending);
      mockPrisma.settlement.update.mockResolvedValue({ ...mockSettlementPending, status: 'PROCESSING' });

      const result = await service.markProcessing('sett-001', { bankName: 'Ecobank', bankAccount: 'CI00123' }, ADMIN_ID);
      expect(result.status).toBe('PROCESSING');
      expect(mockPrisma.settlement.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSING', processedById: ADMIN_ID }) }),
      );
    });

    it('should throw ForbiddenException when status is not PENDING', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue(mockSettlementProcessing);
      await expect(service.markProcessing('sett-001', {}, ADMIN_ID)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when settlement not found', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue(null);
      await expect(service.markProcessing('not-found', {}, ADMIN_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── markPaid ─────────────────────────────────────────────────────────────────

  describe('markPaid', () => {
    it('should transition PROCESSING → PAID and send email', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue(mockSettlementProcessing);
      mockPrisma.settlement.update.mockResolvedValue({ ...mockSettlementProcessing, status: 'PAID', transferRef: 'REF-001' });
      mockPrisma.user.findFirst.mockResolvedValue({ email: 'owner@test.ci', firstName: 'Kouassi', tenant: { name: 'Transport CI' } });

      const result = await service.markPaid('sett-001', { transferRef: 'REF-001' }, ADMIN_ID);

      expect(result.status).toBe('PAID');
      expect(mockPrisma.settlement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID', transferRef: 'REF-001' }),
        }),
      );
      // Email is async (fire-and-forget), give time for promise to settle
      await new Promise(r => setTimeout(r, 10));
      expect(mockEmail.sendSettlementPaid).toHaveBeenCalledWith(
        'owner@test.ci',
        expect.objectContaining({ transferRef: 'REF-001', netAmount: 190000 }),
      );
    });

    it('should throw ForbiddenException when status is not PROCESSING', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue(mockSettlementPending);
      await expect(service.markPaid('sett-001', { transferRef: 'REF' }, ADMIN_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── markFailed ────────────────────────────────────────────────────────────────

  describe('markFailed', () => {
    it('should mark settlement as FAILED and send email', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue(mockSettlementProcessing);
      mockPrisma.settlement.update.mockResolvedValue({ ...mockSettlementProcessing, status: 'FAILED' });
      mockPrisma.user.findFirst.mockResolvedValue({ email: 'owner@test.ci', firstName: 'Kouassi', tenant: { name: 'Transport CI' } });

      const result = await service.markFailed('sett-001', { notes: 'IBAN incorrect' }, ADMIN_ID);

      expect(result.status).toBe('FAILED');
      await new Promise(r => setTimeout(r, 10));
      expect(mockEmail.sendSettlementFailed).toHaveBeenCalledWith(
        'owner@test.ci',
        expect.objectContaining({ notes: 'IBAN incorrect' }),
      );
    });

    it('should throw NotFoundException when settlement not found', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue(null);
      await expect(service.markFailed('not-found', {}, ADMIN_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── submitBankDetails ────────────────────────────────────────────────────────

  describe('submitBankDetails', () => {
    it('should update bank details on PENDING settlement', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue(mockSettlementPending);
      mockPrisma.settlement.update.mockResolvedValue({ ...mockSettlementPending, bankName: 'Ecobank', bankAccount: 'CI00' });

      const result = await service.submitBankDetails('sett-001', { bankName: 'Ecobank', bankAccount: 'CI00' }, TENANT_ID);
      expect(result.bankName).toBe('Ecobank');
    });

    it('should throw ForbiddenException on PAID settlement', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue({ ...mockSettlementPending, status: 'PAID' });
      await expect(
        service.submitBankDetails('sett-001', { bankName: 'x', bankAccount: 'y' }, TENANT_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when tenant mismatch', async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue({ ...mockSettlementPending, tenantId: 'other' });
      await expect(
        service.submitBankDetails('sett-001', { bankName: 'x', bankAccount: 'y' }, TENANT_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── triggerManual ─────────────────────────────────────────────────────────────

  describe('triggerManual', () => {
    it('should throw ForbiddenException when settlement already exists for period', async () => {
      mockPrisma.settlement.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(service.triggerManual(TENANT_ID, 2026, 5, ADMIN_ID)).rejects.toThrow(ForbiddenException);
    });

    it('should call computeForTenant when no existing settlement', async () => {
      mockPrisma.settlement.findFirst.mockResolvedValue(null);
      mockPrisma.payment.findMany.mockResolvedValue([]);

      const result = await service.triggerManual(TENANT_ID, 2026, 5, ADMIN_ID);
      expect(result).toBeNull(); // no payments → null
    });
  });

  // ── mySummary ────────────────────────────────────────────────────────────────

  describe('mySummary', () => {
    it('should aggregate settlements into KPIs', async () => {
      const settlements = [
        { ...mockSettlementPending, status: 'PAID', netAmount: 100000 },
        { ...mockSettlementPending, id: 'sett-002', status: 'PENDING', netAmount: 80000 },
      ];
      mockPrisma.settlement.findMany.mockResolvedValue(settlements);

      const result = await service.mySummary(TENANT_ID);

      expect(result.totalPaid).toBe(100000);
      expect(result.totalPending).toBe(80000);
      expect(result.count).toBe(2);
      expect(result.monthly).toHaveLength(2);
    });
  });
});
