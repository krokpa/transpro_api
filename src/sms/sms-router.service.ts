import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MtnSmsService } from './mtn-sms.service';
import { SmsService } from './sms.service';

/**
 * Router SMS : MTN principal → Africa's Talking fallback → mock si aucun actif.
 * Toutes les expéditions passent par ici (OTP, notifications système, SMS compagnie).
 */
@Injectable()
export class SmsRouterService {
  private readonly logger = new Logger(SmsRouterService.name);

  constructor(
    private mtn: MtnSmsService,
    private africastalking: SmsService,
    private prisma: PrismaService,
  ) {}

  /**
   * Envoie un SMS système (OTP, notifications TransPro).
   * Pas de décompte de crédits tenant.
   */
  async send(to: string | string[], message: string, sender?: string): Promise<void> {
    const provider = await this.dispatch(to, message, sender);
    await this.logSms(null, to, message, sender ?? 'TRANSPRO-CI', provider);
  }

  /**
   * Envoie un SMS pour le compte d'un tenant.
   * Décompte les crédits et utilise le sender personnalisé si disponible.
   */
  async sendForTenant(
    tenantId: string,
    to: string | string[],
    message: string,
  ): Promise<void> {
    // Récupérer le crédit actif du tenant
    const credit = await this.prisma.smsCredit.findFirst({
      where: {
        tenantId,
        remaining: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
    });

    const count = Array.isArray(to) ? to.length : 1;
    const sender = credit?.customSender ?? 'TRANSPRO-CI';

    if (!credit || credit.remaining < count) {
      this.logger.warn(`Tenant ${tenantId} n'a pas assez de crédits SMS (restant: ${credit?.remaining ?? 0}, requis: ${count})`);
      throw new Error('Crédits SMS insuffisants. Achetez un pack SMS dans votre dashboard.');
    }

    const provider = await this.dispatch(to, message, sender);

    await this.prisma.smsCredit.update({
      where: { id: credit.id },
      data: { remaining: { decrement: count } },
    });

    await this.logSms(tenantId, to, message, sender, provider);
  }

  private async dispatch(
    to: string | string[],
    message: string,
    sender?: string,
  ): Promise<string> {
    // 1. Essayer MTN
    if (this.mtn.isEnabled) {
      const sent = await this.mtn.send(to, message, sender);
      if (sent) return 'mtn';
      this.logger.warn('[SmsRouter] MTN a échoué, tentative Africa\'s Talking...');
    }

    // 2. Fallback Africa's Talking
    try {
      await this.africastalking.send(to, message);
      return 'africastalking';
    } catch (err: any) {
      this.logger.error(`[SmsRouter] Africa's Talking a également échoué: ${err?.message}`);
    }

    // 3. Mock (log seulement)
    const recipients = Array.isArray(to) ? to.join(',') : to;
    this.logger.debug(`[SMS Mock → ${recipients}]: ${message}`);
    return 'mock';
  }

  private async logSms(
    tenantId: string | null,
    to: string | string[],
    message: string,
    sender: string,
    provider: string,
  ): Promise<void> {
    const recipients = Array.isArray(to) ? to : [to];
    await this.prisma.smsLog.createMany({
      data: recipients.map((num) => ({
        tenantId,
        to: num,
        message,
        sender,
        status: 'sent',
        provider: provider.toUpperCase() as any,
        cost: 1,
      })),
    });
  }
}
