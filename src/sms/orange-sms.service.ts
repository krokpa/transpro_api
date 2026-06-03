import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface OrangeTokenCache {
  token: string;
  expiresAt: number; // ms epoch
}

/**
 * Orange CI SMS API — OMA REST messaging
 * Docs : https://developer.orange.com/apis/sms-ci/api-reference
 *
 * Auth  : OAuth2 client_credentials → POST /oauth/v3/token
 * Send  : POST /smsmessaging/v1/outbound/{senderAddress}/requests
 *
 * Numéros en entrée : format international (+225XXXXXXXXXX).
 * L'API Orange attend `tel:+225XXXXXXXXXX` dans le payload.
 */
@Injectable()
export class OrangeSmsService {
  private readonly logger = new Logger(OrangeSmsService.name);

  private readonly clientId: string;
  private readonly clientSecret: string;
  /** Adresse expéditeur enregistrée : alphanumérique ou numéro CI au format tel:+225XXXXXXXX */
  private readonly senderAddress: string;
  private readonly enabled: boolean;

  private static readonly BASE_URL   = 'https://api.orange.com';
  private static readonly TOKEN_PATH = '/oauth/v3/token';
  private static readonly SMS_PATH   = '/smsmessaging/v1/outbound';

  private tokenCache: OrangeTokenCache | null = null;

  constructor(private readonly config: ConfigService) {
    this.clientId      = this.config.get('ORANGE_SMS_CLIENT_ID', '');
    this.clientSecret  = this.config.get('ORANGE_SMS_CLIENT_SECRET', '');
    this.senderAddress = this.config.get('ORANGE_SMS_SENDER', 'TRANSPRO-CI');
    this.enabled       = !!(this.clientId && this.clientSecret);

    if (!this.enabled) {
      this.logger.warn(
        'Orange SMS désactivé — configurez ORANGE_SMS_CLIENT_ID et ORANGE_SMS_CLIENT_SECRET',
      );
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Envoie un SMS via l'API Orange CI.
   * @returns true si l'envoi a réussi, false sinon (pour permettre le fallback).
   */
  async send(to: string | string[], message: string, sender?: string): Promise<boolean> {
    if (!this.enabled) return false;

    const token = await this.getAccessToken();
    if (!token) return false;

    const senderAddr = sender ?? this.senderAddress;

    // L'API Orange attend le senderAddress URL-encodé dans le path
    const encodedSender = encodeURIComponent(senderAddr);

    // Construire la liste des destinataires au format tel:+225XXXXXXXXXX
    const addresses = (Array.isArray(to) ? to : [to]).map((n) =>
      n.startsWith('tel:') ? n : `tel:${n.startsWith('+') ? n : '+' + n}`,
    );

    try {
      await axios.post(
        `${OrangeSmsService.BASE_URL}${OrangeSmsService.SMS_PATH}/${encodedSender}/requests`,
        {
          outboundSMSMessageRequest: {
            address: addresses,
            senderAddress: senderAddr,
            outboundSMSTextMessage: {
              message,
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        },
      );

      this.logger.log(
        `[Orange SMS] envoyé à ${addresses.join(',')} (sender: ${senderAddr})`,
      );
      return true;
    } catch (err: any) {
      const detail =
        err?.response?.data?.requestError?.serviceException?.text ??
        err?.response?.data?.message ??
        err?.message;
      this.logger.error(
        `[Orange SMS] échec vers ${addresses.join(',')}: ${detail}`,
      );
      return false;
    }
  }

  // ── OAuth2 token (client_credentials) ────────────────────────────────────

  private async getAccessToken(): Promise<string | null> {
    // Servir depuis le cache si encore valide (marge 60 s)
    if (this.tokenCache && this.tokenCache.expiresAt - 60_000 > Date.now()) {
      return this.tokenCache.token;
    }

    try {
      const credentials = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString('base64');

      const res = await axios.post(
        `${OrangeSmsService.BASE_URL}${OrangeSmsService.TOKEN_PATH}`,
        new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
        {
          headers: {
            Authorization: `Basic ${credentials}`,
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
      this.logger.error(
        `[Orange SMS] Auth OAuth2 échouée: ${err?.response?.data?.message ?? err?.message}`,
      );
      this.tokenCache = null;
      return null;
    }
  }
}
