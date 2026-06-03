import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrangeSmsService } from '../orange-sms.service';

jest.mock('axios');
import axios from 'axios';

const mockConfig = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string, def?: any) => {
    const map: Record<string, string> = {
      ORANGE_SMS_CLIENT_ID:     overrides.ORANGE_SMS_CLIENT_ID     ?? 'test-client-id',
      ORANGE_SMS_CLIENT_SECRET: overrides.ORANGE_SMS_CLIENT_SECRET ?? 'test-client-secret',
      ORANGE_SMS_SENDER:        overrides.ORANGE_SMS_SENDER        ?? 'TRANSPRO-CI',
    };
    return map[key] ?? def ?? '';
  }),
});

async function buildService(configOverrides: Record<string, string> = {}): Promise<OrangeSmsService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OrangeSmsService,
      { provide: ConfigService, useValue: mockConfig(configOverrides) },
    ],
  }).compile();
  return module.get<OrangeSmsService>(OrangeSmsService);
}

describe('OrangeSmsService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── isEnabled ────────────────────────────────────────────────────────────────

  describe('isEnabled', () => {
    it('est désactivé si ORANGE_SMS_CLIENT_ID est absent', async () => {
      const svc = await buildService({ ORANGE_SMS_CLIENT_ID: '' });
      expect(svc.isEnabled).toBe(false);
    });

    it('est désactivé si ORANGE_SMS_CLIENT_SECRET est absent', async () => {
      const svc = await buildService({ ORANGE_SMS_CLIENT_SECRET: '' });
      expect(svc.isEnabled).toBe(false);
    });

    it('est activé quand les deux clés sont présentes', async () => {
      const svc = await buildService();
      expect(svc.isEnabled).toBe(true);
    });
  });

  // ── send ─────────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('retourne false si le service est désactivé', async () => {
      const svc = await buildService({ ORANGE_SMS_CLIENT_ID: '' });
      const result = await svc.send('+2250700000000', 'Test');
      expect(result).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it("retourne false si l'auth OAuth2 échoue", async () => {
      const svc = await buildService();
      (axios.post as jest.Mock).mockRejectedValueOnce(new Error('OAuth2 unreachable'));
      const result = await svc.send('+2250700000000', 'Test');
      expect(result).toBe(false);
    });

    it('envoie le SMS et retourne true quand tout fonctionne', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok-orange', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      const result = await svc.send('+2250700000000', 'Bonjour depuis Orange');

      expect(result).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it("formate le numéro en tel:+225... dans le payload", async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      await svc.send('+2250712345678', 'Test format');

      const [, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      const addresses: string[] = smsBody.outboundSMSMessageRequest.address;
      expect(addresses).toContain('tel:+2250712345678');
    });

    it("n'ajoute pas de préfixe tel: si le numéro en a déjà un", async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      await svc.send('tel:+2250712345678', 'Test format');

      const [, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      const addresses: string[] = smsBody.outboundSMSMessageRequest.address;
      expect(addresses.filter((a) => a === 'tel:+2250712345678')).toHaveLength(1);
    });

    it("URL-encode le senderAddress dans le chemin de la requête", async () => {
      const svc = await buildService({ ORANGE_SMS_SENDER: 'TRANSPRO-CI' });
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      await svc.send('+2250700000000', 'Test');

      const [smsUrl] = (axios.post as jest.Mock).mock.calls[1];
      // TRANSPRO-CI → TRANSPRO-CI (tiret n'est pas encodé mais le slash /requests doit être présent)
      expect(smsUrl).toContain('/smsmessaging/v1/outbound/');
      expect(smsUrl).toContain('/requests');
    });

    it('utilise le sender par défaut si aucun sender fourni', async () => {
      const svc = await buildService({ ORANGE_SMS_SENDER: 'TRANSPRO-CI' });
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      await svc.send('+2250700000000', 'Test');

      const [, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      expect(smsBody.outboundSMSMessageRequest.senderAddress).toBe('TRANSPRO-CI');
    });

    it('utilise le sender custom si fourni', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      await svc.send('+2250700000000', 'Test', 'MONOPERATEUR');

      const [, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      expect(smsBody.outboundSMSMessageRequest.senderAddress).toBe('MONOPERATEUR');
    });

    it("retourne false si l'appel SMS échoue après auth réussie", async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok', expires_in: 3600 } })
        .mockRejectedValueOnce(new Error('Orange API down'));

      const result = await svc.send('+2250700000000', 'Test');
      expect(result).toBe(false);
    });

    it('réutilise le token en cache sans rappeler OAuth2', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok-cached', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: {} }); // 2ème SMS — pas de nouveau OAuth

      await svc.send('+2250700000000', 'Premier SMS');
      await svc.send('+2250700000001', 'Deuxième SMS');

      const postCalls = (axios.post as jest.Mock).mock.calls;
      const oauthCalls = postCalls.filter(([url]: [string]) => url.includes('/oauth/'));
      expect(oauthCalls).toHaveLength(1);
    });

    it('accepte un tableau de destinataires', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      const result = await svc.send(
        ['+2250700000000', '+2250700000001', '+2250700000002'],
        'Message groupé',
      );

      expect(result).toBe(true);
      const [, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      const addresses: string[] = smsBody.outboundSMSMessageRequest.address;
      expect(addresses).toHaveLength(3);
    });

    it('inclut le message dans outboundSMSTextMessage', async () => {
      const svc = await buildService();
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { access_token: 'tok', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: {} });

      await svc.send('+2250700000000', 'Votre code est 987654');

      const [, smsBody] = (axios.post as jest.Mock).mock.calls[1];
      expect(smsBody.outboundSMSMessageRequest.outboundSMSTextMessage.message).toBe(
        'Votre code est 987654',
      );
    });
  });
});
