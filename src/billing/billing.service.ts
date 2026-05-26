import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import dayjs from 'dayjs';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
  ) {}

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
      this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { usedAt: { not: null } },
          ],
        },
      }),
    ]);
    this.logger.log(
      `Token cleanup: ${refresh.count} refresh, ${reset.count} reset tokens removed`,
    );
  }

  // ── Trial tenants ────────────────────────────────────────────────────────

  private async processTrials(now: dayjs.Dayjs) {
    const appUrl = this.config.get('APP_URL', 'http://localhost:3000');
    const renewUrl = `${appUrl}/dashboard/subscription`;

    // Suspend trials that have expired
    const expired = await this.prisma.tenant.findMany({
      where: { status: 'TRIAL', trialEndsAt: { lt: now.toDate() } },
      include: {
        users: {
          where: { role: 'COMPANY_OWNER' },
          select: { email: true, firstName: true },
          take: 1,
        },
      },
    });

    for (const tenant of expired) {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED' },
      });
      const owner = tenant.users[0];
      if (owner) {
        await this.email.sendTrialExpired(
          owner.email,
          owner.firstName,
          tenant.name,
          renewUrl,
        );
      }
      this.logger.warn(`Tenant "${tenant.name}" trial expired → SUSPENDED`);
    }

    // Warn 7 days before
    await this.notifyTrialExpiringSoon(now, 7, renewUrl);
    // Warn 3 days before
    await this.notifyTrialExpiringSoon(now, 3, renewUrl);
    // Warn 1 day before
    await this.notifyTrialExpiringSoon(now, 1, renewUrl);
  }

  private async notifyTrialExpiringSoon(
    now: dayjs.Dayjs,
    daysAhead: number,
    renewUrl: string,
  ) {
    const targetDay = now.add(daysAhead, 'day');
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: {
          gte: targetDay.startOf('day').toDate(),
          lte: targetDay.endOf('day').toDate(),
        },
      },
      include: {
        users: {
          where: { role: 'COMPANY_OWNER' },
          select: { email: true, firstName: true },
          take: 1,
        },
      },
    });

    for (const tenant of tenants) {
      const owner = tenant.users[0];
      if (owner) {
        await this.email.sendTrialExpiringSoon(
          owner.email,
          owner.firstName,
          tenant.name,
          daysAhead,
          renewUrl,
        );
        this.logger.log(
          `Trial expiry warning sent to "${tenant.name}" (J-${daysAhead})`,
        );
      }
    }
  }

  // ── Active subscriptions ─────────────────────────────────────────────────

  private async processSubscriptions(now: dayjs.Dayjs) {
    const appUrl = this.config.get('APP_URL', 'http://localhost:3000');
    const renewUrl = `${appUrl}/dashboard/subscription`;

    // Suspend subscriptions that have expired
    const expired = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        subscriptionEndsAt: { lt: now.toDate() },
        NOT: { subscriptionEndsAt: null },
      },
      include: {
        users: {
          where: { role: 'COMPANY_OWNER' },
          select: { email: true, firstName: true },
          take: 1,
        },
      },
    });

    for (const tenant of expired) {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED' },
      });
      const owner = tenant.users[0];
      if (owner) {
        await this.email.sendSubscriptionExpired(
          owner.email,
          owner.firstName,
          tenant.name,
          renewUrl,
        );
      }
      this.logger.warn(
        `Tenant "${tenant.name}" subscription expired → SUSPENDED`,
      );
    }

    // Warn 7, 3, 1 days before
    for (const daysAhead of [7, 3, 1]) {
      await this.notifySubscriptionExpiringSoon(now, daysAhead, renewUrl);
    }
  }

  private async notifySubscriptionExpiringSoon(
    now: dayjs.Dayjs,
    daysAhead: number,
    renewUrl: string,
  ) {
    const targetDay = now.add(daysAhead, 'day');
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        subscriptionEndsAt: {
          gte: targetDay.startOf('day').toDate(),
          lte: targetDay.endOf('day').toDate(),
        },
      },
      include: {
        users: {
          where: { role: 'COMPANY_OWNER' },
          select: { email: true, firstName: true },
          take: 1,
        },
      },
    });

    for (const tenant of tenants) {
      const owner = tenant.users[0];
      if (owner) {
        await this.email.sendSubscriptionExpiringSoon(
          owner.email,
          owner.firstName,
          tenant.name,
          daysAhead,
          tenant.monthlyFee,
          renewUrl,
        );
        this.logger.log(
          `Subscription expiry warning sent to "${tenant.name}" (J-${daysAhead})`,
        );
      }
    }
  }

  /** Manual trigger for super-admin (also usable in tests) */
  async runNow() {
    await this.checkSubscriptions();
    return { message: 'Subscription check completed' };
  }
}
