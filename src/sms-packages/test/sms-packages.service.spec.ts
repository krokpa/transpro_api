import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsPackagesService } from '../sms-packages.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrisma } from '../../common/test/mock-prisma';

jest.mock('axios');
import axios from 'axios';

const mockPrisma = createMockPrisma();

const mockConfig = {
  get: jest.fn((key: string, def?: any) => {
    const map: Record<string, any> = {
      GENIUSPAY_API_KEY:    'test-key',
      GENIUSPAY_API_SECRET: 'test-secret',
      FRONTEND_URL:         'http://localhost:3000',
    };
    return map[key] ?? def ?? '';
  }),
};

const TENANT_ID  = 'tenant-1';
const PACKAGE_ID = 'pkg-1';

const mockPackage = {
  id: PACKAGE_ID,
  name: 'Starter 500',
  smsCount: 500,
  priceXof: 5000,
  hasCustomSender: false,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPackagePro = {
  ...mockPackage,
  id: 'pkg-2',
  name: 'Enterprise 10000',
  smsCount: 10000,
  priceXof: 75000,
  hasCustomSender: true,
};

describe('SmsPackagesService', () => {
  let service: SmsPackagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsPackagesService,
        { provide: PrismaService,  useValue: mockPrisma },
        { provide: ConfigService,  useValue: mockConfig },
      ],
    }).compile();

    service = module.get<SmsPackagesService>(SmsPackagesService);
    jest.clearAllMocks();
  });

  // ── listPackages ──────────────────────────────────────────────────────────

  describe('listPackages', () => {
    it('retourne uniquement les packages actifs par défaut', async () => {
      mockPrisma.smsPackage.findMany.mockResolvedValue([mockPackage]);

      const result = await service.listPackages();

      expect(mockPrisma.smsPackage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      expect(result).toHaveLength(1);
    });

    it('retourne tous les packages si activeOnly=false', async () => {
      mockPrisma.smsPackage.findMany.mockResolvedValue([mockPackage, { ...mockPackage, isActive: false }]);

      await service.listPackages(false);

      expect(mockPrisma.smsPackage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  // ── createPackage ─────────────────────────────────────────────────────────

  describe('createPackage', () => {
    it('crée un package et le retourne', async () => {
      mockPrisma.smsPackage.create.mockResolvedValue(mockPackage);

      const result = await service.createPackage({
        name: 'Starter 500', smsCount: 500, priceXof: 5000,
      });

      expect(mockPrisma.smsPackage.create).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('Starter 500');
    });
  });

  // ── updatePackage ─────────────────────────────────────────────────────────

  describe('updatePackage', () => {
    it('lève NotFoundException si le package est introuvable', async () => {
      mockPrisma.smsPackage.findUnique.mockResolvedValue(null);

      await expect(service.updatePackage('bad-id', { name: 'X' }))
        .rejects.toThrow(NotFoundException);
    });

    it('met à jour le package', async () => {
      mockPrisma.smsPackage.findUnique.mockResolvedValue(mockPackage);
      mockPrisma.smsPackage.update.mockResolvedValue({ ...mockPackage, name: 'Updated' });

      const result = await service.updatePackage(PACKAGE_ID, { name: 'Updated' });

      expect(result.name).toBe('Updated');
    });
  });

  // ── getBalance ────────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('retourne le total des crédits restants', async () => {
      mockPrisma.smsCredit.findMany.mockResolvedValue([
        { id: 'c1', remaining: 300, customSender: null },
        { id: 'c2', remaining: 200, customSender: 'TRANSIT' },
      ]);

      const result = await service.getBalance(TENANT_ID);

      expect(result.total).toBe(500);
      expect(result.customSender).toBe('TRANSIT');
    });

    it('retourne 0 si aucun crédit', async () => {
      mockPrisma.smsCredit.findMany.mockResolvedValue([]);

      const result = await service.getBalance(TENANT_ID);

      expect(result.total).toBe(0);
      expect(result.customSender).toBeNull();
    });
  });

  // ── initiatePurchase ──────────────────────────────────────────────────────

  describe('initiatePurchase', () => {
    const mockTenant = {
      id: TENANT_ID, name: 'Transit CI', phone: '+2250700000000',
      users: [{ email: 'owner@transit.ci', firstName: 'Amos', lastName: 'Kouassi', phone: '+2250700000000' }],
    };

    it('lève NotFoundException si le package est introuvable', async () => {
      mockPrisma.smsPackage.findUnique.mockResolvedValue(null);

      await expect(service.initiatePurchase(TENANT_ID, { packageId: 'bad' }))
        .rejects.toThrow(NotFoundException);
    });

    it('lève BadRequestException si customSender requis mais absent', async () => {
      mockPrisma.smsPackage.findUnique.mockResolvedValue(mockPackagePro);
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);

      await expect(
        service.initiatePurchase(TENANT_ID, { packageId: PACKAGE_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lève BadRequestException si customSender fourni sur un package sans cette option', async () => {
      mockPrisma.smsPackage.findUnique.mockResolvedValue(mockPackage); // hasCustomSender: false

      await expect(
        service.initiatePurchase(TENANT_ID, { packageId: PACKAGE_ID, customSender: 'TEST' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('initie un paiement Genius Pay et crée un SmsPurchase', async () => {
      mockPrisma.smsPackage.findUnique.mockResolvedValue(mockPackage);
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.smsPurchase.create.mockResolvedValue({ ...mockPackage, id: 'purchase-1' });
      (axios.post as jest.Mock).mockResolvedValue({
        data: { data: { checkout_url: 'https://pay.genius.ci/checkout/abc', reference: 'REF-123' } },
      });

      const result = await service.initiatePurchase(TENANT_ID, { packageId: PACKAGE_ID });

      expect(result.checkoutUrl).toContain('checkout');
      expect(mockPrisma.smsPurchase.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── getLogs ───────────────────────────────────────────────────────────────

  describe('getLogs', () => {
    it('retourne les logs paginés', async () => {
      const logs = [{ id: 'log-1', to: TENANT_ID, message: 'Hello', createdAt: new Date() }];
      mockPrisma.smsLog.findMany.mockResolvedValue(logs);
      mockPrisma.smsLog.count.mockResolvedValue(1);

      const result = await service.getLogs(TENANT_ID, 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.pages).toBe(1);
    });
  });
});
