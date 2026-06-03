import { Test, TestingModule } from '@nestjs/testing';
import { SmsRouterService } from '../sms-router.service';
import { OrangeSmsService } from '../orange-sms.service';
import { MtnSmsService } from '../mtn-sms.service';
import { SmsService } from '../sms.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrisma } from '../../common/test/mock-prisma';

const mockPrisma = createMockPrisma();

const PHONE  = '+2250712345678';
const TENANT = 'tenant-1';

const makeCredit = (overrides: Partial<any> = {}) => ({
  id: 'credit-1',
  tenantId: TENANT,
  remaining: 100,
  customSender: null,
  expiresAt: null,
  ...overrides,
});

describe('SmsRouterService', () => {
  let service: SmsRouterService;
  let mockOrange: jest.Mocked<Pick<OrangeSmsService, 'send' | 'isEnabled'>>;
  let mockMtn:    jest.Mocked<Pick<MtnSmsService,    'send' | 'isEnabled'>>;
  let mockAt:     jest.Mocked<Pick<SmsService,        'send'>>;

  beforeEach(async () => {
    mockOrange = { send: jest.fn(), isEnabled: true } as any;
    mockMtn    = { send: jest.fn(), isEnabled: true } as any;
    mockAt     = { send: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsRouterService,
        { provide: OrangeSmsService, useValue: mockOrange },
        { provide: MtnSmsService,    useValue: mockMtn },
        { provide: SmsService,       useValue: mockAt },
        { provide: PrismaService,    useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SmsRouterService>(SmsRouterService);
    jest.clearAllMocks();
    mockPrisma.smsLog.createMany.mockResolvedValue({ count: 1 });
  });

  // ── send (système) ─────────────────────────────────────────────────────────

  describe('send', () => {
    it('achemine vers Orange si activé et réussi', async () => {
      mockOrange.send.mockResolvedValue(true);

      await service.send(PHONE, 'Code: 123456');

      expect(mockOrange.send).toHaveBeenCalledWith(PHONE, 'Code: 123456', undefined);
      expect(mockMtn.send).not.toHaveBeenCalled();
      expect(mockAt.send).not.toHaveBeenCalled();
      expect(mockPrisma.smsLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ provider: 'ORANGE' }),
          ]),
        }),
      );
    });

    it('bascule vers MTN si Orange échoue', async () => {
      mockOrange.send.mockResolvedValue(false);
      mockMtn.send.mockResolvedValue(true);

      await service.send(PHONE, 'Fallback MTN');

      expect(mockOrange.send).toHaveBeenCalledTimes(1);
      expect(mockMtn.send).toHaveBeenCalledWith(PHONE, 'Fallback MTN', undefined);
      expect(mockAt.send).not.toHaveBeenCalled();
      expect(mockPrisma.smsLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ provider: 'MTN' }),
          ]),
        }),
      );
    });

    it("bascule vers Africa's Talking si Orange et MTN échouent", async () => {
      mockOrange.send.mockResolvedValue(false);
      mockMtn.send.mockResolvedValue(false);
      mockAt.send.mockResolvedValue(undefined);

      await service.send(PHONE, 'Fallback AT');

      expect(mockAt.send).toHaveBeenCalledWith(PHONE, 'Fallback AT');
      expect(mockPrisma.smsLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ provider: 'AFRICASTALKING' }),
          ]),
        }),
      );
    });

    it('utilise le mock si tous les providers échouent', async () => {
      mockOrange.send.mockResolvedValue(false);
      mockMtn.send.mockResolvedValue(false);
      mockAt.send.mockRejectedValue(new Error('AT down'));

      await expect(service.send(PHONE, 'Mock fallback')).resolves.not.toThrow();

      expect(mockPrisma.smsLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ provider: 'MOCK' }),
          ]),
        }),
      );
    });

    it('ignore Orange si désactivé et essaie MTN directement', async () => {
      Object.defineProperty(mockOrange, 'isEnabled', { get: () => false });
      mockMtn.send.mockResolvedValue(true);

      await service.send(PHONE, 'Direct MTN');

      expect(mockOrange.send).not.toHaveBeenCalled();
      expect(mockMtn.send).toHaveBeenCalled();
    });

    it('ignore Orange et MTN si tous deux désactivés et passe à AT', async () => {
      Object.defineProperty(mockOrange, 'isEnabled', { get: () => false });
      Object.defineProperty(mockMtn,    'isEnabled', { get: () => false });
      mockAt.send.mockResolvedValue(undefined);

      await service.send(PHONE, 'Direct AT');

      expect(mockOrange.send).not.toHaveBeenCalled();
      expect(mockMtn.send).not.toHaveBeenCalled();
      expect(mockAt.send).toHaveBeenCalled();
    });

    it('log le SMS avec le bon sender', async () => {
      mockOrange.send.mockResolvedValue(true);

      await service.send(PHONE, 'Test', 'MON-SENDER');

      expect(mockPrisma.smsLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ sender: 'MON-SENDER' }),
          ]),
        }),
      );
    });
  });

  // ── sendForTenant ──────────────────────────────────────────────────────────

  describe('sendForTenant', () => {
    it("lève une erreur si le tenant n'a pas de crédits", async () => {
      mockPrisma.smsCredit.findFirst.mockResolvedValue(null);

      await expect(service.sendForTenant(TENANT, PHONE, 'Hello')).rejects.toThrow(
        'Crédits SMS insuffisants',
      );
      expect(mockOrange.send).not.toHaveBeenCalled();
    });

    it('lève une erreur si les crédits sont insuffisants', async () => {
      mockPrisma.smsCredit.findFirst.mockResolvedValue(makeCredit({ remaining: 0 }));

      await expect(service.sendForTenant(TENANT, PHONE, 'Hello')).rejects.toThrow(
        'Crédits SMS insuffisants',
      );
    });

    it('envoie via Orange et décrémente les crédits', async () => {
      mockPrisma.smsCredit.findFirst.mockResolvedValue(makeCredit({ remaining: 50 }));
      mockPrisma.smsCredit.update.mockResolvedValue({} as any);
      mockOrange.send.mockResolvedValue(true);

      await service.sendForTenant(TENANT, PHONE, 'Votre commande est confirmée');

      expect(mockOrange.send).toHaveBeenCalledTimes(1);
      expect(mockPrisma.smsCredit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { remaining: { decrement: 1 } } }),
      );
    });

    it('utilise le customSender du crédit si disponible', async () => {
      mockPrisma.smsCredit.findFirst.mockResolvedValue(
        makeCredit({ remaining: 10, customSender: 'TRANSIT-CI' }),
      );
      mockPrisma.smsCredit.update.mockResolvedValue({} as any);
      mockOrange.send.mockResolvedValue(true);

      await service.sendForTenant(TENANT, PHONE, 'Message');

      expect(mockOrange.send).toHaveBeenCalledWith(PHONE, 'Message', 'TRANSIT-CI');
    });

    it('utilise TRANSPRO-CI comme sender si aucun customSender', async () => {
      mockPrisma.smsCredit.findFirst.mockResolvedValue(
        makeCredit({ remaining: 10, customSender: null }),
      );
      mockPrisma.smsCredit.update.mockResolvedValue({} as any);
      mockOrange.send.mockResolvedValue(true);

      await service.sendForTenant(TENANT, PHONE, 'Message');

      expect(mockOrange.send).toHaveBeenCalledWith(PHONE, 'Message', 'TRANSPRO-CI');
    });

    it('décompte le bon nombre de crédits pour un envoi groupé', async () => {
      const recipients = ['+2250700000001', '+2250700000002', '+2250700000003'];
      mockPrisma.smsCredit.findFirst.mockResolvedValue(makeCredit({ remaining: 50 }));
      mockPrisma.smsCredit.update.mockResolvedValue({} as any);
      mockOrange.send.mockResolvedValue(true);

      await service.sendForTenant(TENANT, recipients, 'Bulk message');

      expect(mockPrisma.smsCredit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { remaining: { decrement: 3 } } }),
      );
    });
  });
});
