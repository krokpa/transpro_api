import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CashProvisionsService } from '../cash-provisions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrisma } from '../../common/test/mock-prisma';

const mockPrisma = createMockPrisma();

const TENANT_ID  = 'tenant-abc';
const STATION_ID = 'station-001';
const USER_ID    = 'user-001';

const mockUser = { sub: USER_ID, tenantId: TENANT_ID, role: 'COMPANY_ADMIN', stationIds: [] as string[] };
const mockStation = { id: STATION_ID, tenantId: TENANT_ID, name: 'Gare d\'Adjamé' };

const mockProvision = {
  id: 'prov-001',
  tenantId:      TENANT_ID,
  stationId:     STATION_ID,
  amount:        50000,
  reason:        'Réapprovisionnement hebdomadaire',
  notes:         null,
  status:        'REQUESTED',
  requestedById: USER_ID,
  approvedById:  null,
  approvedAt:    null,
  sentAt:        null,
  receivedAt:    null,
  rejectedAt:    null,
  rejectedReason: null,
  createdAt:     new Date(),
};

const withIncludes = (p: any) => ({ ...p, station: mockStation, requestedBy: { firstName: 'Y', lastName: 'K' }, approvedBy: null });

describe('CashProvisionsService', () => {
  let service: CashProvisionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashProvisionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CashProvisionsService>(CashProvisionsService);
    jest.clearAllMocks();
  });

  // ── create ───────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a REQUESTED provision when station is valid', async () => {
      mockPrisma.station.findFirst.mockResolvedValue(mockStation);
      mockPrisma.cashProvision.create.mockResolvedValue(withIncludes(mockProvision));

      const result = await service.create(
        { stationId: STATION_ID, amount: 50000, reason: 'Réappro' },
        mockUser,
      );

      expect(result.status).toBe('REQUESTED');
      expect(mockPrisma.cashProvision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REQUESTED', tenantId: TENANT_ID }),
        }),
      );
    });

    it('should throw NotFoundException when station not in tenant', async () => {
      mockPrisma.station.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ stationId: 'bad-id', amount: 50000, reason: 'x' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── approve ──────────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('should transition REQUESTED → APPROVED', async () => {
      mockPrisma.cashProvision.findUnique
        .mockResolvedValueOnce(mockProvision)      // first call in approve()
        .mockResolvedValueOnce(mockProvision);     // second call in update()
      mockPrisma.cashProvision.update.mockResolvedValue(withIncludes({ ...mockProvision, status: 'APPROVED' }));

      const result = await service.approve('prov-001', mockUser);
      expect(result.status).toBe('APPROVED');
    });

    it('should throw BadRequestException when status is not REQUESTED', async () => {
      mockPrisma.cashProvision.findUnique.mockResolvedValue({ ...mockProvision, status: 'APPROVED' });
      await expect(service.approve('prov-001', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  // ── send ─────────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('should transition APPROVED → SENT', async () => {
      const approved = { ...mockProvision, status: 'APPROVED' };
      mockPrisma.cashProvision.findUnique
        .mockResolvedValueOnce(approved)
        .mockResolvedValueOnce(approved);
      mockPrisma.cashProvision.update.mockResolvedValue(withIncludes({ ...approved, status: 'SENT' }));

      const result = await service.send('prov-001', 'Ref MoMo 123', mockUser);
      expect(result.status).toBe('SENT');
      expect(mockPrisma.cashProvision.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SENT', notes: 'Ref MoMo 123' }) }),
      );
    });

    it('should throw BadRequestException when status is not APPROVED', async () => {
      mockPrisma.cashProvision.findUnique.mockResolvedValue(mockProvision); // REQUESTED
      await expect(service.send('prov-001', undefined, mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  // ── receive ──────────────────────────────────────────────────────────────────

  describe('receive', () => {
    it('should transition SENT → RECEIVED', async () => {
      const sent = { ...mockProvision, status: 'SENT' };
      mockPrisma.cashProvision.findUnique
        .mockResolvedValueOnce(sent)
        .mockResolvedValueOnce(sent);
      mockPrisma.cashProvision.update.mockResolvedValue(withIncludes({ ...sent, status: 'RECEIVED' }));

      const result = await service.receive('prov-001', mockUser);
      expect(result.status).toBe('RECEIVED');
    });

    it('should throw BadRequestException when status is not SENT', async () => {
      mockPrisma.cashProvision.findUnique.mockResolvedValue(mockProvision); // REQUESTED
      await expect(service.receive('prov-001', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  // ── reject ───────────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('should reject from REQUESTED status', async () => {
      mockPrisma.cashProvision.findUnique
        .mockResolvedValueOnce(mockProvision)
        .mockResolvedValueOnce(mockProvision);
      mockPrisma.cashProvision.update.mockResolvedValue(
        withIncludes({ ...mockProvision, status: 'REJECTED', rejectedReason: 'Budget insuffisant' }),
      );

      const result = await service.reject('prov-001', 'Budget insuffisant', mockUser);
      expect(result.status).toBe('REJECTED');
    });

    it('should reject from APPROVED status', async () => {
      const approved = { ...mockProvision, status: 'APPROVED' };
      mockPrisma.cashProvision.findUnique
        .mockResolvedValueOnce(approved)
        .mockResolvedValueOnce(approved);
      mockPrisma.cashProvision.update.mockResolvedValue(
        withIncludes({ ...approved, status: 'REJECTED' }),
      );
      const result = await service.reject('prov-001', 'Annulation', mockUser);
      expect(result.status).toBe('REJECTED');
    });

    it('should throw BadRequestException when status is SENT or RECEIVED', async () => {
      mockPrisma.cashProvision.findUnique.mockResolvedValue({ ...mockProvision, status: 'SENT' });
      await expect(service.reject('prov-001', 'reason', mockUser)).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when tenant mismatch', async () => {
      mockPrisma.cashProvision.findUnique.mockResolvedValue({ ...mockProvision, tenantId: 'other' });
      await expect(service.reject('prov-001', 'reason', mockUser)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return provision for same tenant', async () => {
      mockPrisma.cashProvision.findUnique.mockResolvedValue(withIncludes(mockProvision));
      const result = await service.findOne('prov-001', mockUser);
      expect(result.id).toBe('prov-001');
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.cashProvision.findUnique.mockResolvedValue(null);
      await expect(service.findOne('not-found', mockUser)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when tenant mismatch', async () => {
      mockPrisma.cashProvision.findUnique.mockResolvedValue({ ...withIncludes(mockProvision), tenantId: 'other' });
      await expect(service.findOne('prov-001', mockUser)).rejects.toThrow(ForbiddenException);
    });
  });
});
