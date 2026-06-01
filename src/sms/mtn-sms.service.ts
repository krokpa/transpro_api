import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface MtnTokenCache {
  token: string;
  expiresAt: number; // ms epoch
}

@Injectable()
export class MtnSmsService {
  private readonly logger = new Logger(MtnSmsService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly subscriptionKey: string;
  private readonly defaultSender: string;
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private tokenCache: MtnTokenCache | null = null;

  constructor(private config: ConfigService) {
    this.clientId        = this.config.get('MTN_SMS_CLIENT_ID', '');
    this.clientSecret    = this.config.get('MTN_SMS_CLIENT_SECRET', '');
    this.subscriptionKey = this.config.get('MTN_SMS_SUBSCRIPTION_KEY', '');
    this.defaultSender   = this.config.get('MTN_SMS_DEFAULT_SENDER', 'TRANSPRO-CI');
    const env            = this.config.get('MTN_SMS_ENVIRONMENT', 'sandbox');
    this.baseUrl         = env === 'production'
      ? 'https://api.mtn.com'
      : 'https://api.mtn.com'; // MTN utilise le même host, sandbox contrôlé par les clés

    this.enabled = !!(this.clientId && this.clientSecret && this.subscriptionKey);
    if (!this.enabled) {
      this.logger.warn('MTN SMS désactivé — configurez MTN_SMS_CLIENT_ID, MTN_SMS_CLIENT_SECRET, MTN_SMS_SUBSCRIPTION_KEY');
    }
  }

  get isEnabled() {
    return this.enabled;
  }

  async send(to: string | string[], message: string, sender?: string): Promise<boolean> {
    if (!this.enabled) return false;

    const recipients = (Array.isArray(to) ? to : [to]).map((n) =>
      n.startsWith('+') ? n.slice(1) : n,
    );

    const token = await this.getAccessToken();
    if (!token) return false;

    const correlatorId = `transpro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      await axios.post(
        `${this.baseUrl}/sms/v3/sendSMS`,
        {
          senderAddress: sender ?? this.defaultSender,
          receiverAddress: recipients,
          message,
          clientCorrelatorId: correlatorId,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        },
      );
      this.logger.log(`[MTN SMS] envoyé à ${recipients.join(',')} (sender: ${sender ?? this.defaultSender})`);
      return true;
    } catch (err: any) {
      this.logger.error(
        `[MTN SMS] échec vers ${recipients.join(',')}: ${err?.response?.data?.message ?? err?.message}`,
      );
      return false;
    }
  }

  private async getAccessToken(): Promise<string | null> {
    // Retourner le token en cache s'il est encore valide (marge 60s)
    if (this.tokenCache && this.tokenCache.expiresAt - 60_000 > Date.now()) {
      return this.tokenCache.token;
    }

    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const res = await axios.post(
        `${this.baseUrl}/oauth/access-token`,
        new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10_000,
        },
      );

      const { access_token, expires_in } = res.data;
      this.tokenCache = {
        token: access_token,
        expiresAt: Date.now() + (expires_in ?? 3600) * 1000,
      };
      return access_token;
    } catch (err: any) {
      this.logger.error(`[MTN SMS] Auth OAuth2 échouée: ${err?.response?.data?.message ?? err?.message}`);
      this.tokenCache = null;
      return null;
    }
  }
}
