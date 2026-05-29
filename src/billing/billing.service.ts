import {
  Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import dayjs from 'dayjs';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TenantPlan, PLAN_PRICING, getPlanFeatures } from '@transpro/shared';
import { generateReference } from '@transpro/shared';

const GENIUSPAY_BASE = 'https://pay.genius.ci/api/v1/merchant';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
  ) {}

  // ── Subscription payment (Genius Pay) ────────────────────────────────────

  /** Initie le paiement d'un abonnement ou renouvellement via Genius Pay. */
  async initiateSubscriptionPayment(tenantId: string, plan: TenantPlan) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: {
          where: { role: 'COMPANY_OWNER' },
          select: { email: true, firstName: true, lastName: true, phone: true },
          take: 1,
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant introuvable');

    const planCfg   = PLAN_PRICING[plan];
    const amount    = planCfg.priceMonthly;
    const owner     = tenant.users[0];
    if (!owner) throw new BadRequestException('Aucun propriétaire trouvé pour ce tenant');

    // Annuler tout abonnement PROCESSING existant pour éviter les doublons
    const pendingSub = await this.prisma.subscription.findFirst({
      where: { tenantId, isPaid: false, checkoutUrl: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (pendingSub?.checkoutUrl) {
      // Si le lien a moins de 30 min → retourner celui-là
      const createdAt = dayjs(pendingSub.createdAt);
      if (dayjs().diff(createdAt, 'minute') < 30) {
        return { checkoutUrl: pendingSub.checkoutUrl, subscriptionId: pendingSub.id };
      }
    }

    const startDate  = dayjs().toDate();
    const endDate    = dayjs().add(1, 'month').toDate();
    const transactionId = generateReference('SUB');

    const appUrl = this.config.get('FRONTEND_URL') || this.config.get('APP_URL') || 'http://localhost:3000';
    const successUrl = `${appUrl}/dashboard/subscription/payment/success`;
    const errorUrl   = `${appUrl}/dashboard/subscription/payment/error`;

    let geniusRes: any;
    try {
      geniusRes = await this.callGeniusPay({
        amount,
        description: `Abonnement ${planCfg.label} — ${tenant.name}`,
        customer: {
          name: `${owner.firstName} ${owner.lastName}`,
          email: owner.email,
          phone: owner.phone ?? tenant.phone,
        },
        successUrl,
        errorUrl,
        metadata: { transactionId, tenantId, plan },
      });
    } catch (err) {
      this.logger.error(`GeniusPay subscription init failed for tenant ${tenantId}`, err);
      throw new BadRequestException('Erreur lors de l\'initiation du paiement. Réessayez.');
    }

    if (!geniusRes?.checkout_url) {
      throw new BadRequestException('Lien de paiement non reçu du prestataire');
    }

    const subscription = await this.prisma.subscription.create({
      data: {
        tenantId,
        plan,
        amount,
        startDate,
        endDate,
        isPaid: false,
        providerRef: geniusRes.reference,
        providerData: geniusRes,
        checkoutUrl: geniusRes.checkout_url,
      },
    });

    return { checkoutUrl: geniusRes.checkout_url, subscriptionId: subscription.id };
  }

  /** Webhook Genius Pay pour confirmation de paiement abonnement. */
  async handleSubscriptionWebhook(rawBody: string, rawSignature: string, timestamp: string) {
    const webhookSecret = this.config.get('GENIUSPAY_WEBHOOK_SECRET', '');

    if (webhookSecret && rawSignature) {
      const data = `${timestamp}.${rawBody}`;
      const expected = crypto.createHmac('sha256', webhookSecret).update(data).digest('hex');
      const sigBuf = Buffer.from(rawSignature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new UnauthorizedException('Signature webhook invalide');
      }
      if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) {
        throw new BadRequestException('Webhook expiré');
      }
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch (err: any) {
      this.logger.error(`[SubWebhook] Payload JSON invalide: ${err.message}`);
      throw new BadRequestException('Payload invalide');
    }

    const ref    = body?.data?.reference ?? body?.reference;
    const status = body?.data?.status    ?? body?.status;
    const meta   = body?.data?.metadata  ?? body?.metadata ?? {};

    if (!ref) {
      this.logger.warn('[SubWebhook] Aucune référence dans le payload');
      return { received: true };
    }

    this.logger.log(`[SubWebhook] ref=${ref} status=${status}`);

    if (status === 'success' || status === 'SUCCESSFUL') {
      await this.confirmSubscriptionPayment(ref, meta?.paymentChannel ?? body?.data?.payment_channel);
    } else if (status === 'failed' || status === 'FAILED') {
      await this.handleFailedSubscriptionPayment(ref);
    }

    return { received: true };
  }

  /** Confirmation manuelle depuis la page de redirection post-paiement. */
  async confirmFromRedirect(subscriptionId: string, tenantId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, tenantId },
    });
    if (!sub) throw new NotFoundException('Abonnement introuvable');
    if (sub.isPaid) return { status: 'SUCCESS', alreadyConfirmed: true };
    if (!sub.providerRef) throw new BadRequestException('Aucune référence fournisseur');

    // Interroger Genius Pay pour vérifier le statut
    try {
      const res = await this.checkGeniusPayStatus(sub.providerRef);
      const status = res?.status ?? res?.data?.status;
      if (status === 'success' || status === 'SUCCESSFUL') {
        await this.confirmSubscriptionPayment(sub.providerRef, res?.data?.payment_channel);
        return { status: 'SUCCESS' };
      }
      return { status: 'PENDING' };
    } catch (err) {
      this.logger.error('Error checking subscription payment status', err);
      return { status: 'UNKNOWN' };
    }
  }

  private async confirmSubscriptionPayment(providerRef: string, paymentChannel?: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { providerRef, isPaid: false },
      include: {
        tenant: {
          include: {
            users: {
              where: { role: 'COMPANY_OWNER' },
              select: { email: true, firstName: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!sub) {
      this.logger.warn(`[SubWebhook] Subscription not found or already paid for ref=${providerRef}`);
      return;
    }

    const paidAt = new Date();
    await this.prisma.$transaction([
      this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          isPaid: true,
          paidAt,
          paymentMethod: paymentChannel,
          checkoutUrl: null,
        },
      }),
      this.prisma.tenant.update({
        where: { id: sub.tenantId },
        data: {
          status: 'ACTIVE',
          plan: sub.plan,
          subscriptionEndsAt: sub.endDate,
          monthlyFee: sub.amount,
        },
      }),
    ]);

    this.logger.log(`Subscription confirmed: tenant=${sub.tenantId} plan=${sub.plan}`);

    const owner = sub.tenant.users[0];
    if (owner) {
      const appUrl = this.config.get('FRONTEND_URL') || this.config.get('APP_URL') || 'http://localhost:3000';
      await this.email.sendSubscriptionPaymentSuccess(
        owner.email,
        owner.firstName,
        sub.tenant.name,
        PLAN_PRICING[sub.plan as TenantPlan]?.label ?? sub.plan,
        sub.amount,
        sub.endDate,
        `${appUrl}/dashboard`,
      ).catch((err) => this.logger.error('Failed to send payment success email', err));
    }
  }

  private async handleFailedSubscriptionPayment(providerRef: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { providerRef, isPaid: false },
      include: {
        tenant: {
          include: {
            users: {
              where: { role: 'COMPANY_OWNER' },
              select: { email: true, firstName: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!sub) return;

    this.logger.warn(`Subscription payment failed: tenant=${sub.tenantId}`);

    const owner = sub.tenant.users[0];
    if (owner) {
      const appUrl = this.config.get('FRONTEND_URL') || this.config.get('APP_URL') || 'http://localhost:3000';
      await this.email.sendSubscriptionPaymentFailed(
        owner.email,
        owner.firstName,
        sub.tenant.name,
        `${appUrl}/dashboard/subscription`,
      ).catch(() => {});
    }
  }

  private async callGeniusPay(params: {
    amount: number;
    description: string;
    customer: { name: string; email: string; phone: string };
    successUrl: string;
    errorUrl: string;
    metadata: Record<string, any>;
  }) {
    const apiKey    = this.config.get('GENIUSPAY_API_KEY');
    const apiSecret = this.config.get('GENIUSPAY_API_SECRET');
    const res = await axios.post(
      `${GENIUSPAY_BASE}/payments`,
      {
        amount: params.amount,
        currency: 'XOF',
        description: params.description,
        customer: { ...params.customer, country: 'CI' },
        success_url: params.successUrl,
        error_url: params.errorUrl,
        metadata: params.metadata,
      },
      {
        headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
        timeout: 15_000,
      },
    );
    return res.data?.data ?? res.data;
  }

  private async checkGeniusPayStatus(providerRef: string) {
    const apiKey    = this.config.get('GENIUSPAY_API_KEY');
    const apiSecret = this.config.get('GENIUSPAY_API_SECRET');
    const res = await axios.get(`${GENIUSPAY_BASE}/payments/${providerRef}`, {
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret },
      timeout: 10_000,
    });
    return res.data?.data ?? res.data;
  }

  // ── Crons expiration ─────────────────────────────────────────────────────

  /** Subscription & trial expiry checks — every day at 07:00 */
  @Cron('0 7 * * *')
  async checkSubscriptions() {
    this.logger.log('Running subscription expiry check...');
    const now = dayjs();
    await Promise.all([
      this.processTrials(now),
      this.processSubscriptions(now),
    ]);
  }

  /** Token cleanup — every day at 02:00 */
  @Cron('0 2 * * *')
  async cleanupExpiredTokens() {
    const [refresh, reset] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      this.prisma.passwordResetToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
      }),
    ]);
    this.logger.log(`Token cleanup: ${refresh.count} refresh, ${reset.count} reset tokens removed`);
  }

  // ── Trial tenants ────────────────────────────────────────────────────────

  private async processTrials(now: dayjs.Dayjs) {
    const appUrl  = this.config.get('APP_URL', 'http://localhost:3000');
    const renewUrl = `${appUrl}/dashboard/subscription`;

    const expired = await this.prisma.tenant.findMany({
      where: { status: 'TRIAL', trialEndsAt: { lt: now.toDate() } },
      include: { users: { where: { role: 'COMPANY_OWNER' }, select: { email: true, firstName: true }, take: 1 } },
    });

    for (const tenant of expired) {
      await this.prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'SUSPENDED' } });
      const owner = tenant.users[0];
      if (owner) {
        await this.email.sendTrialExpired(owner.email, owner.firstName, tenant.name, renewUrl);
      }
      this.logger.warn(`Tenant "${tenant.name}" trial expired → SUSPENDED`);
    }

    for (const d of [7, 3, 1]) {
      await this.notifyTrialExpiringSoon(now, d, renewUrl);
    }
  }

  private async notifyTrialExpiringSoon(now: dayjs.Dayjs, daysAhead: number, renewUrl: string) {
    const targetDay = now.add(daysAhead, 'day');
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { gte: targetDay.startOf('day').toDate(), lte: targetDay.endOf('day').toDate() },
      },
      include: { users: { where: { role: 'COMPANY_OWNER' }, select: { email: true, firstName: true }, take: 1 } },
    });
    for (const tenant of tenants) {
      const owner = tenant.users[0];
      if (owner) {
        await this.email.sendTrialExpiringSoon(owner.email, owner.firstName, tenant.name, daysAhead, renewUrl);
        this.logger.log(`Trial expiry warning sent to "${tenant.name}" (J-${daysAhead})`);
      }
    }
  }

  // ── Active subscriptions ─────────────────────────────────────────────────

  private async processSubscriptions(now: dayjs.Dayjs) {
    const appUrl  = this.config.get('APP_URL', 'http://localhost:3000');
    const renewUrl = `${appUrl}/dashboard/subscription`;

    const expired = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', subscriptionEndsAt: { lt: now.toDate() }, NOT: { subscriptionEndsAt: null } },
      include: { users: { where: { role: 'COMPANY_OWNER' }, select: { email: true, firstName: true }, take: 1 } },
    });

    for (const tenant of expired) {
      await this.prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'SUSPENDED' } });
      const owner = tenant.users[0];
      if (owner) {
        await this.email.sendSubscriptionExpired(owner.email, owner.firstName, tenant.name, renewUrl);
      }
      this.logger.warn(`Tenant "${tenant.name}" subscription expired → SUSPENDED`);
    }

    for (const d of [7, 3, 1]) {
      await this.notifySubscriptionExpiringSoon(now, d, renewUrl);
    }
  }

  private async notifySubscriptionExpiringSoon(now: dayjs.Dayjs, daysAhead: number, renewUrl: string) {
    const targetDay = now.add(daysAhead, 'day');
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        subscriptionEndsAt: { gte: targetDay.startOf('day').toDate(), lte: targetDay.endOf('day').toDate() },
      },
      include: { users: { where: { role: 'COMPANY_OWNER' }, select: { email: true, firstName: true }, take: 1 } },
    });
    for (const tenant of tenants) {
      const owner = tenant.users[0];
      if (owner) {
        await this.email.sendSubscriptionExpiringSoon(
          owner.email, owner.firstName, tenant.name, daysAhead, tenant.monthlyFee, renewUrl,
        );
        this.logger.log(`Subscription expiry warning sent to "${tenant.name}" (J-${daysAhead})`);
      }
    }
  }

  /** Manual trigger for super-admin */
  async runNow() {
    await this.checkSubscriptions();
    return { message: 'Subscription check completed' };
  }
}
