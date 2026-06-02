import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MtnSmsService } from '../mtn-sms.service';

jest.mock('axios');
import axios from 'axios';

const mockConfig = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string, def?: any) => {
    const map: Record<string, string> = {
      MTN_SMS_CLIENT_ID:        overrides.MTN_SMS_CLIENT_ID        ?? 'test-id',
      MTN_SMS_CLIENT_SECRET:    overrides.MTN_SMS_CLIENT_SECRET    ?? 'test-secret',
      MTN_SMS_SUBSCRIPTION_KEY: overrides.MTN_SMS_SUBSCRIPTION_KEY ?? 'test-sub-key',
      MTN_SMS_DEFAULT_SENDER:   overrides.MTN_SMS_DEFAULT_SENDER   ?? 'TRANSPRO-CI',
      MTN_SMS_ENVIRONMENT:      overrides.MTN_SMS_ENVIRONMENT      ?? 'sandbox',
    };
    return map[key] ?? def ?? '';
  }),
});

async function buildService(configOverrides: Record<string, string> = {}): Promise<MtnSmsService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MtnSmsService,
      { provide: ConfigService, useValue: mockConfig(configOverrides) },
    ],
  }).compile();
  return module.get<MtnSmsService>(MtnSmsService);
}

describe('MtnSmsService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── isEnabled ─────────────────────────────────────────────────────────────

  describe('isEnabled', () => {
    it('est désactivé si MTN_SMS_CLIENT_ID est absent', async () => {
      const svc = await buildService({ MTN_SMS_CLIENT_ID: '' });
      expect(svc.isEnabled).toBe(false);
    });

    it('est activé quand toutes les clés sont présentes', async () => {
      const svc = await buildService();
      expect(svc.isEnabled).toBe(true);
    });
  });

  // ── send ──────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('retourne false si le service est désactivé', async () => {
      const svc = await buildService({ MTN_SMS_CLIENT_ID: '' });
      const result = await svc.send('+2250700000000', 'Test');
      expect(result).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('retourne false si l\'auth OAuth2 échoue', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock).mockRejectedValueOnce(new Error('OAuth2 unreachable'));
      const result = await svc.send('+2250700000000', 'Test');
      expect(result).toBe(false);
    });

    it('envoie le SMS et retourne true quand tout fonctionne', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok-abc', expires_in: 3600 } }) // OAuth
        .mockResolvedValueOnce({ data: {} }); // SMS send

      const result = await svc.send('+2250700000000', 'Bonjour');

      expect(result).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(2);
      const [smsUrl, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      expect(smsUrl).toContain('/sms/v3/sendSMS');
      expect(smsBody.receiverAddress).toContain('2250700000000');
    });

    it('utilise le sender par défaut si aucun sender fourni', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok-abc', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      await svc.send('+2250700000000', 'Test');

      const [, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      expect(smsBody.senderAddress).toBe('TRANSPRO-CI');
    });

    it('utilise le sender custom si fourni', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok-abc', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      await svc.send('+2250700000000', 'Test', 'MON-SENDER');

      const [, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      expect(smsBody.senderAddress).toBe('MON-SENDER');
    });

    it('retourne false si l\'appel SMS échoue après auth réussie', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok-abc', expires_in: 3600 } })
        .mockRejectedValueOnce(new Error('SMS API down'));

      const result = await svc.send('+2250700000000', 'Test');
      expect(result).toBe(false);
    });

    it('réutilise le token mis en cache sans rappeler OAuth2', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok-cached', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: {} }); // 2ème SMS — pas de nouveau OAuth

      await svc.send('+2250700000000', 'Premier');
      await svc.send('+2250700000001', 'Deuxième');

      // OAuth appelé 1 seule fois, SMS appelé 2 fois
      const postCalls = (axios.post as jest.Mock).mock.calls;
      const oauthCalls = postCalls.filter(([url]) => url.includes('oauth'));
      expect(oauthCalls).toHaveLength(1);
    });

    it('accepte un tableau de destinataires', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok-abc', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      const result = await svc.send(['+2250700000000', '+2250700000001'], 'Bulk');

      expect(result).toBe(true);
      const [, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      expect(smsBody.receiverAddress).toHaveLength(2);
    });
  });
});
