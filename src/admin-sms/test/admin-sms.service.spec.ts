import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminSmsService } from '../admin-sms.service';
import { OrangeSmsService } from '../../sms/orange-sms.service';
import { MtnSmsService } from '../../sms/mtn-sms.service';
import { SmsService as AtSmsService } from '../../sms/sms.service';
import { SmsRouterService } from '../../sms/sms-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrisma } from '../../common/test/mock-prisma';

const mockPrisma = createMockPrisma();

const mockConfig = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string, def?: any) => {
    const map: Record<string, string> = {
      ORANGE_SMS_CLIENT_ID:     overrides.ORANGE_SMS_CLIENT_ID     ?? 'orange-id',
      ORANGE_SMS_CLIENT_SECRET: overrides.ORANGE_SMS_CLIENT_SECRET ?? 'orange-secret',
      ORANGE_SMS_SENDER:        overrides.ORANGE_SMS_SENDER        ?? 'TRANSPRO-CI',
      MTN_SMS_CLIENT_ID:        overrides.MTN_SMS_CLIENT_ID        ?? 'mtn-id',
      AFRICASTALKING_API_KEY:   overrides.AFRICASTALKING_API_KEY   ?? '',
      AFRICASTALKING_USERNAME:  overrides.AFRICASTALKING_USERNAME  ?? 'sandbox',
      MTN_SMS_DEFAULT_SENDER:   overrides.MTN_SMS_DEFAULT_SENDER   ?? 'TRANSPRO-CI',
      AFRICASTALKING_SENDER:    overrides.AFRICASTALKING_SENDER    ?? '',
    };
    return map[key] ?? def ?? '';
  }),
});

const TENANT_ID = 'tenant-uuid-1';
const TENANT_NAME = 'Trans Abidjan';

function makeTenant(overrides: Partial<any> = {}) {
  return { id: TENANT_ID, name: TENANT_NAME, slug: 'trans-abidjan', ...overrides };
}

function makeSmsLog(overrides: Partial<any> = {}) {
  return {
    id: 'log-1',
    tenantId: TENANT_ID,
    to: '+2250700000000',
    message: 'Test',
    sender: 'TRANSPRO-CI',
    provider: 'ORANGE',
    status: 'sent',
    cost: 0,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  };
}

describe('AdminSmsService', () => {
  let service: AdminSmsService;
  let mockOrange: jest.Mocked<Pick<OrangeSmsService, 'isEnabled'>>;
  let mockMtn:    jest.Mocked<Pick<MtnSmsService,    'isEnabled'>>;
  let mockRouter: jest.Mocked<Pick<SmsRouterService,  'send'>>;

  beforeEach(async () => {
    mockOrange = { isEnabled: true } as any;
    mockMtn    = { isEnabled: true } as any;
    mockRouter = { send: jest.fn().mockResolvedValue(undefined) } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSmsService,
        { provide: PrismaService,    useValue: mockPrisma },
        { provide: ConfigService,    useValue: mockConfig() },
        { provide: OrangeSmsService, useValue: mockOrange },
        { provide: MtnSmsService,    useValue: mockMtn },
        { provide: AtSmsService,     useValue: {} },
        { provide: SmsRouterService, useValue: mockRouter },
      ],
    }).compile();

    service = module.get<AdminSmsService>(AdminSmsService);
    jest.clearAllMocks();
  });

  // ── getOverview ───────────────────────────────────────────────────────────

  describe('getOverview', () => {
    it('retourne les volumes par provider, statut et timeline', async () => {
      mockPrisma.smsLog.groupBy
        .mockResolvedValueOnce([
          { provider: 'ORANGE', _count: { id: 80 } },
          { provider: 'MTN',    _count: { id: 15 } },
        ])
        .mockResolvedValueOnce([
          { status: 'sent',   _count: { id: 90 } },
          { status: 'failed', _count: { id: 5 } },
        ]);
      mockPrisma.$queryRaw.mockResolvedValue([
        { day: new Date('2026-06-01'), provider: 'ORANGE', count: BigInt(30) },
      ]);
      mockPrisma.smsLog.groupBy.mockResolvedValueOnce([
        { tenantId: TENANT_ID, _count: { id: 50 } },
      ]);
      mockPrisma.smsLog.aggregate.mockResolvedValue({ _count: { id: 95 } });
      mockPrisma.tenant.findMany.mockResolvedValue([makeTenant()]);

      const result = await service.getOverview(30);

      expect(result.total).toBe(95);
      expect(result.byProvider).toEqual(
        expect.arrayContaining([
          { provider: 'ORANGE', count: 80 },
          { provider: 'MTN', count: 15 },
        ]),
      );
      expect(result.byStatus).toEqual(
        expect.arrayContaining([
          { status: 'sent', count: 90 },
        ]),
      );
      expect(result.timeline[0].count).toBe(30);
      expect(result.topTenants[0].name).toBe(TENANT_NAME);
    });

    it('utilise "Système" comme nom si le tenant est inconnu', async () => {
      mockPrisma.smsLog.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ tenantId: 'unknown-id', _count: { id: 5 } }]);
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockPrisma.smsLog.aggregate.mockResolvedValue({ _count: { id: 5 } });
      mockPrisma.tenant.findMany.mockResolvedValue([]);

      const result = await service.getOverview(7);

      expect(result.topTenants[0].name).toBe('Système');
    });
  });

  // ── getLogs ───────────────────────────────────────────────────────────────

  describe('getLogs', () => {
    it('retourne les logs paginés enrichis avec le nom du tenant', async () => {
      mockPrisma.smsLog.findMany.mockResolvedValue([makeSmsLog()]);
      mockPrisma.smsLog.count.mockResolvedValue(1);
      mockPrisma.tenant.findMany.mockResolvedValue([makeTenant()]);

      const result = await service.getLogs({ page: 1, limit: 25 });

      expect(result.total).toBe(1);
      expect(result.pages).toBe(1);
      expect(result.items[0]).toMatchObject({
        provider: 'ORANGE',
        tenant: { id: TENANT_ID, name: TENANT_NAME },
      });
    });

    it('retourne tenant: null pour les logs sans tenantId', async () => {
      mockPrisma.smsLog.findMany.mockResolvedValue([makeSmsLog({ tenantId: null })]);
      mockPrisma.smsLog.count.mockResolvedValue(1);

      const result = await service.getLogs({});

      expect(result.items[0].tenant).toBeNull();
      expect(mockPrisma.tenant.findMany).not.toHaveBeenCalled();
    });

    it('construit le filtre de recherche sur to, message et sender', async () => {
      mockPrisma.smsLog.findMany.mockResolvedValue([]);
      mockPrisma.smsLog.count.mockResolvedValue(0);

      await service.getLogs({ search: 'Abidjan' });

      expect(mockPrisma.smsLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ to: expect.objectContaining({ contains: 'Abidjan' }) }),
            ]),
          }),
        }),
      );
    });

    it('filtre par provider et statut si fournis', async () => {
      mockPrisma.smsLog.findMany.mockResolvedValue([]);
      mockPrisma.smsLog.count.mockResolvedValue(0);

      await service.getLogs({ provider: 'ORANGE', status: 'sent' });

      expect(mockPrisma.smsLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ provider: 'ORANGE', status: 'sent' }),
        }),
      );
    });

    it('calcule correctement le nombre de pages', async () => {
      mockPrisma.smsLog.findMany.mockResolvedValue([]);
      mockPrisma.smsLog.count.mockResolvedValue(67);

      const result = await service.getLogs({ page: 1, limit: 25 });

      expect(result.pages).toBe(3); // Math.ceil(67/25) = 3
    });
  });

  // ── getAllCredits ─────────────────────────────────────────────────────────

  describe('getAllCredits', () => {
    it('regroupe les crédits par tenant avec le total restant', async () => {
      mockPrisma.smsCredit.findMany.mockResolvedValue([
        { id: 'c1', tenantId: TENANT_ID, remaining: 50, customSender: null, expiresAt: null, createdAt: new Date(), tenant: makeTenant() },
        { id: 'c2', tenantId: TENANT_ID, remaining: 30, customSender: 'TRANSIT', expiresAt: null, createdAt: new Date(), tenant: makeTenant() },
      ]);
      mockPrisma.tenant.findMany.mockResolvedValue([makeTenant()]);

      const result = await service.getAllCredits();

      expect(result).toHaveLength(1);
      expect(result[0].totalRemaining).toBe(80);
      expect(result[0].customSender).toBe('TRANSIT');
    });

    it('inclut les tenants sans crédit (totalRemaining = 0)', async () => {
      mockPrisma.smsCredit.findMany.mockResolvedValue([]);
      mockPrisma.tenant.findMany.mockResolvedValue([makeTenant()]);

      const result = await service.getAllCredits();

      expect(result).toHaveLength(1);
      expect(result[0].totalRemaining).toBe(0);
    });
  });

  // ── grantCredits ──────────────────────────────────────────────────────────

  describe('grantCredits', () => {
    it('crée un crédit et loggue la transaction système', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(makeTenant());
      mockPrisma.smsCredit.create.mockResolvedValue({ id: 'c-new', remaining: 100 } as any);
      mockPrisma.smsLog.create.mockResolvedValue({} as any);

      const credit = await service.grantCredits(TENANT_ID, 100);

      expect(mockPrisma.smsCredit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID, remaining: 100 }),
        }),
      );
      expect(mockPrisma.smsLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sender: 'SUPER_ADMIN',
            status: 'sent',
            provider: 'MOCK',
          }),
        }),
      );
      expect(credit.remaining).toBe(100);
    });

    it('stocke le customSender en majuscules', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(makeTenant());
      mockPrisma.smsCredit.create.mockResolvedValue({ id: 'c-2', remaining: 50 } as any);
      mockPrisma.smsLog.create.mockResolvedValue({} as any);

      await service.grantCredits(TENANT_ID, 50, 'transit-ci');

      expect(mockPrisma.smsCredit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ customSender: 'TRANSIT-CI' }),
        }),
      );
    });

    it('inclut la note dans le log si fournie', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(makeTenant());
      mockPrisma.smsCredit.create.mockResolvedValue({ id: 'c-3', remaining: 200 } as any);
      mockPrisma.smsLog.create.mockResolvedValue({} as any);

      await service.grantCredits(TENANT_ID, 200, undefined, 'Offre partenariat Q2');

      expect(mockPrisma.smsLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: expect.stringContaining('Offre partenariat Q2'),
          }),
        }),
      );
    });

    it('lève BadRequestException si smsCount <= 0', async () => {
      await expect(service.grantCredits(TENANT_ID, 0)).rejects.toThrow(BadRequestException);
      await expect(service.grantCredits(TENANT_ID, -5)).rejects.toThrow(BadRequestException);
    });

    it("lève BadRequestException si le tenant n'existe pas", async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.grantCredits('unknown-id', 100)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.smsCredit.create).not.toHaveBeenCalled();
    });
  });

  // ── getProvidersStatus ────────────────────────────────────────────────────

  describe('getProvidersStatus', () => {
    it("désigne Orange comme primary si il est actif", () => {
      Object.defineProperty(mockOrange, 'isEnabled', { get: () => true, configurable: true });
      const status = service.getProvidersStatus();
      expect(status.primary).toBe('orange');
    });

    it('désigne MTN comme primary si Orange est inactif', () => {
      Object.defineProperty(mockOrange, 'isEnabled', { get: () => false, configurable: true });
      Object.defineProperty(mockMtn,    'isEnabled', { get: () => true,  configurable: true });
      const status = service.getProvidersStatus();
      expect(status.primary).toBe('mtn');
    });

    it("retourne 4 providers dans le bon ordre de priorité", () => {
      const status = service.getProvidersStatus();
      const orders = status.providers.map((p: any) => p.order);
      expect(orders).toEqual([1, 2, 3, 4]);
    });

    it('marque Orange comme configuré si les clés sont présentes', () => {
      const status = service.getProvidersStatus();
      const orange = status.providers.find((p: any) => p.id === 'orange') as any;
      expect(orange?.configured).toBe(true);
    });

    it("le provider Mock est toujours actif et configuré", () => {
      const status = service.getProvidersStatus();
      const mock = status.providers.find((p: any) => p.id === 'mock') as any;
      expect(mock?.configured).toBe(true);
      expect(mock?.active).toBe(true);
    });
  });

  // ── sendTest ──────────────────────────────────────────────────────────────

  describe('sendTest', () => {
    it('envoie un SMS de test préfixé [TEST TRANSPRO]', async () => {
      await service.sendTest('+2250700000000', 'Vérification');
      expect(mockRouter.send).toHaveBeenCalledWith(
        '+2250700000000',
        '[TEST TRANSPRO] Vérification',
      );
    });

    it('lève BadRequestException si le numéro ne commence pas par +', async () => {
      await expect(service.sendTest('0700000000', 'Test')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lève BadRequestException si le message est vide', async () => {
      await expect(service.sendTest('+2250700000000', '   ')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── listPackages / createPackage / updatePackage ───────────────────────────

  describe('packages CRUD', () => {
    it('listPackages retourne les packs triés par sortOrder puis priceXof', async () => {
      mockPrisma.smsPackage.findMany.mockResolvedValue([
        { id: 'p1', name: 'Starter', smsCount: 100, priceXof: 5000 },
      ]);
      const result = await service.listPackages();
      expect(result).toHaveLength(1);
      expect(mockPrisma.smsPackage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ sortOrder: 'asc' }, { priceXof: 'asc' }],
        }),
      );
    });

    it('createPackage crée un nouveau pack avec les données fournies', async () => {
      mockPrisma.smsPackage.create.mockResolvedValue({
        id: 'p-new', name: 'Pro', smsCount: 500, priceXof: 20000,
      });
      const data = { name: 'Pro', smsCount: 500, priceXof: 20000 };
      const result = await service.createPackage(data);
      expect(mockPrisma.smsPackage.create).toHaveBeenCalledWith({ data });
      expect(result.name).toBe('Pro');
    });

    it('updatePackage met à jour les champs spécifiés', async () => {
      mockPrisma.smsPackage.update.mockResolvedValue({
        id: 'p1', name: 'Starter Plus', smsCount: 150, priceXof: 7000, isActive: true,
      });
      await service.updatePackage('p1', { smsCount: 150, priceXof: 7000 });
      expect(mockPrisma.smsPackage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: { smsCount: 150, priceXof: 7000 },
        }),
      );
    });
  });
});
