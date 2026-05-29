import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BillingService } from '../billing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { createMockPrisma } from '../../common/test/mock-prisma';
import { TenantPlan } from '@transpro/shared';

jest.mock('axios');
import axios from 'axios';

const mockPrisma = createMockPrisma();
const mockEmail = {
  sendSubscriptionPaymentSuccess: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionPaymentFailed:  jest.fn().mockResolvedValue(undefined),
  sendTrialExpiringSoon:          jest.fn().mockResolvedValue(undefined),
  sendTrialExpired:               jest.fn().mockResolvedValue(undefined),
  sendSubscriptionExpiringSoon:   jest.fn().mockResolvedValue(undefined),
  sendSubscriptionExpired:        jest.fn().mockResolvedValue(undefined),
};
const mockConfig = { get: jest.fn((key: string, def?: any) => {
  const map: Record<string, any> = {
    GENIUSPAY_API_KEY:     'test-key',
    GENIUSPAY_API_SECRET:  'test-secret',
    FRONTEND_URL:          'http://localhost:3000',
  };
  return map[key] ?? def ?? '';
}) };

const TENANT_ID = 'tenant-1';
const mockTenant = {
  id: TENANT_ID,
  name: 'Transport Express CI',
  phone: '+2250700000001',
  plan: 'BASIC',
  status: 'TRIAL',
  monthlyFee: 25000,
  users: [{ email: 'owner@test.ci', firstName: 'Kouassi', lastName: 'Yao', phone: '+2250700000002' }],
};

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService,  useValue: mockPrisma  },
        { provide: EmailService,   useValue: mockEmail   },
        { provide: ConfigService,  useValue: mockConfig  },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    jest.clearAllMocks();
  });

  // ── initiateSubscriptionPayment ─────────────────────────────────────────────

  describe('initiateSubscriptionPayment', () => {
    it('should initiate Genius Pay and create subscription record', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      (axios.post as jest.Mock).mockResolvedValue({
        data: { checkout_url: 'https://pay.genius.ci/checkout/abc', reference: 'REF-001' },
      });
      mockPrisma.subscription.create.mockResolvedValue({
        id: 'sub-1',
        tenantId: TENANT_ID,
        plan: TenantPlan.PROFESSIONAL,
        amount: 50000,
        checkoutUrl: 'https://pay.genius.ci/checkout/abc',
      });

      const result = await service.initiateSubscriptionPayment(TENANT_ID, TenantPlan.PROFESSIONAL);

      expect(result.checkoutUrl).toBe('https://pay.genius.ci/checkout/abc');
      expect(result.subscriptionId).toBe('sub-1');
      expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            plan: TenantPlan.PROFESSIONAL,
            amount: 50000,
            isPaid: false,
          }),
        }),
      );
    });

    it('should return existing checkout URL if pending subscription < 30 min', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-existing',
        checkoutUrl: 'https://pay.genius.ci/checkout/existing',
        createdAt: new Date(), // just created
      });

      const result = await service.initiateSubscriptionPayment(TENANT_ID, TenantPlan.PROFESSIONAL);

      expect(result.checkoutUrl).toBe('https://pay.genius.ci/checkout/existing');
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if tenant not found', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.initiateSubscriptionPayment(TENANT_ID, TenantPlan.PROFESSIONAL),
      ).rejects.toThrow('Tenant introuvable');
    });
  });

  // ── handleSubscriptionWebhook (confirmation) ────────────────────────────────

  describe('handleSubscriptionWebhook', () => {
    const mockSub = {
      id: 'sub-1',
      tenantId: TENANT_ID,
      plan: TenantPlan.PROFESSIONAL,
      amount: 50000,
      endDate: new Date(Date.now() + 30 * 86400_000),
      providerRef: 'REF-001',
      isPaid: false,
      tenant: {
        name: mockTenant.name,
        users: [{ email: 'owner@test.ci', firstName: 'Kouassi' }],
      },
    };

    it('should confirm payment on success webhook', async () => {
      const payload = JSON.stringify({
        data: { reference: 'REF-001', status: 'success', payment_channel: 'wave' },
      });
      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.subscription.update.mockResolvedValue({ ...mockSub, isPaid: true });
      mockPrisma.tenant.update.mockResolvedValue({ ...mockTenant, status: 'ACTIVE' });
      mockPrisma.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));

      const result = await service.handleSubscriptionWebhook(payload, '', '');
      expect(result).toEqual({ received: true });
      expect(mockEmail.sendSubscriptionPaymentSuccess).toHaveBeenCalledWith(
        'owner@test.ci',
        'Kouassi',
        mockTenant.name,
        'Professionnel',
        50000,
        mockSub.endDate,
        expect.stringContaining('/dashboard'),
      );
    });

    it('should notify owner on failed webhook', async () => {
      const payload = JSON.stringify({
        data: { reference: 'REF-002', status: 'failed' },
      });
      const failedSub = { ...mockSub, providerRef: 'REF-002' };
      mockPrisma.subscription.findFirst.mockResolvedValue(failedSub);

      await service.handleSubscriptionWebhook(payload, '', '');
      expect(mockEmail.sendSubscriptionPaymentFailed).toHaveBeenCalledWith(
        'owner@test.ci',
        'Kouassi',
        mockTenant.name,
        expect.stringContaining('/dashboard/subscription'),
      );
    });

    it('should return { received: true } for unknown payload', async () => {
      const payload = JSON.stringify({ foo: 'bar' });
      const result = await service.handleSubscriptionWebhook(payload, '', '');
      expect(result).toEqual({ received: true });
    });

    it('should throw on invalid JSON payload', async () => {
      await expect(
        service.handleSubscriptionWebhook('not-json', '', ''),
      ).rejects.toThrow();
    });
  });

  // ── runNow ───────────────────────────────────────────────────────────────────

  describe('runNow', () => {
    it('should trigger checkSubscriptions and return success message', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([]);
      const result = await service.runNow();
      expect(result.message).toBe('Subscription check completed');
    });
  });
});
