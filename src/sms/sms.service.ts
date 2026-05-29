import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly apiKey: string;
  private readonly username: string;
  private readonly sender: string;
  private readonly enabled: boolean;

  constructor(private config: ConfigService) {
    this.apiKey   = this.config.get('AFRICASTALKING_API_KEY', '');
    this.username = this.config.get('AFRICASTALKING_USERNAME', 'sandbox');
    this.sender   = this.config.get('AFRICASTALKING_SENDER', '');
    this.enabled  = !!(this.apiKey && this.username !== 'sandbox');

    if (!this.enabled) {
      this.logger.warn('SMS désactivé — configurez AFRICASTALKING_API_KEY et AFRICASTALKING_USERNAME');
    }
  }

  /**
   * Envoie un SMS à un ou plusieurs numéros.
   * Les numéros doivent être au format international (+225XXXXXXXXXX).
   */
  async send(to: string | string[], message: string): Promise<void> {
    if (!this.enabled) {
      this.logger.debug(`[SMS simulé → ${Array.isArray(to) ? to.join(',') : to}]: ${message}`);
      return;
    }

    const recipients = Array.isArray(to) ? to.join(',') : to;

    try {
      const params = new URLSearchParams({ username: this.username, to: recipients, message });
      if (this.sender) params.set('from', this.sender);

      await axios.post(
        'https://api.africastalking.com/version1/messaging',
        params.toString(),
        {
          headers: {
            apiKey: this.apiKey,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10_000,
        },
      );
    } catch (err: any) {
      this.logger.error(
        `Échec SMS vers ${recipients}: ${err?.response?.data?.SMSMessageData?.Message ?? err?.message}`,
      );
    }
  }

  // ── Message templates ──────────────────────────────────────────────────────

  parcelCollected(trackingCode: string, deliveryCity: string): string {
    return `TransPro CI - Votre colis ${trackingCode} a été pris en charge et est en route vers ${deliveryCity}. Suivez-le sur l'app.`;
  }

  parcelInTransit(trackingCode: string, deliveryCity: string): string {
    return `TransPro CI - Votre colis ${trackingCode} est en transit vers ${deliveryCity}.`;
  }

  parcelArrived(trackingCode: string, deliveryCity: string): string {
    return `TransPro CI - Votre colis ${trackingCode} est arrivé à ${deliveryCity}. Vous pouvez le récupérer à la gare.`;
  }

  parcelDelivered(trackingCode: string, deliveryCity: string): string {
    return `TransPro CI - Votre colis ${trackingCode} a été remis au destinataire à ${deliveryCity}. Merci d'avoir utilisé TransPro CI.`;
  }

  parcelCreated(trackingCode: string, deliveryCity: string): string {
    return `TransPro CI - Votre colis ${trackingCode} a été enregistré. Il sera acheminé vers ${deliveryCity}. Gardez ce code pour le suivi.`;
  }
}
