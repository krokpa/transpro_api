import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OrangeSmsService } from '../sms/orange-sms.service';
import { MtnSmsService } from '../sms/mtn-sms.service';
import { SmsService as AtSmsService } from '../sms/sms.service';
import { SmsRouterService } from '../sms/sms-router.service';
import dayjs from 'dayjs';

@Injectable()
export class AdminSmsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private orange: OrangeSmsService,
    private mtn: MtnSmsService,
    private at: AtSmsService,
    private router: SmsRouterService,
  ) {}

  // ── Overview ──────────────────────────────────────────────────────────────

  async getOverview(days = 30) {
    const since = dayjs().subtract(days, 'day').startOf('day').toDate();

    const [byProvider, byStatus, timeline, topTenants, totals] = await Promise.all([
      // Volume par provider
      this.prisma.smsLog.groupBy({
        by: ['provider'],
        where: { createdAt: { gte: since } },
        _count: { id: true },
      }),

      // Volume par statut
      this.prisma.smsLog.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { id: true },
      }),

      // Timeline quotidienne
      this.prisma.$queryRaw<{ day: Date; provider: string; count: bigint }[]>`
        SELECT
          DATE_TRUNC('day', "createdAt") AS day,
          provider,
          COUNT(*)::int AS count
        FROM "SmsLog"
        WHERE "createdAt" >= ${since}
        GROUP BY day, provider
        ORDER BY day ASC
      `,

      // Top 5 compagnies
      this.prisma.smsLog.groupBy({
        by: ['tenantId'],
        where: { createdAt: { gte: since }, tenantId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),

      // Totaux globaux (all time)
      this.prisma.smsLog.aggregate({
        _count: { id: true },
        where: { createdAt: { gte: since } },
      }),
    ]);

    // Enrichir top tenants avec les noms
    const tenantIds = topTenants.map((t) => t.tenantId).filter(Boolean) as string[];
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const tenantMap = Object.fromEntries(tenants.map((t) => [t.id, t.name]));

    return {
      period: { days, since },
      total: totals._count.id,
      byProvider: byProvider.map((r) => ({
        provider: r.provider,
        count: r._count.id,
      })),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count.id,
      })),
      timeline: timeline.map((r) => ({
        day: r.day,
        provider: r.provider,
        count: Number(r.count),
      })),
      topTenants: topTenants.map((r) => ({
        tenantId: r.tenantId,
        name: tenantMap[r.tenantId!] ?? 'Système',
        count: r._count.id,
      })),
    };
  }

  // ── Logs all-tenants ──────────────────────────────────────────────────────

  async getLogs(params: {
    page?: number;
    limit?: number;
    tenantId?: string;
    provider?: string;
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const { page = 1, limit = 25, tenantId, provider, status, search, dateFrom, dateTo } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (tenantId)  where.tenantId = tenantId;
    if (provider)  where.provider = provider;
    if (status)    where.status   = status;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = dayjs(dateTo).endOf('day').toDate();
    }
    if (search) {
      where.OR = [
        { to:      { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
        { sender:  { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.smsLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.smsLog.count({ where }),
    ]);

    // Enrichir avec les noms de compagnies (SmsLog n'a pas de relation Prisma vers Tenant)
    const tenantIds = [...new Set(items.map((i) => i.tenantId).filter(Boolean))] as string[];
    const tenants   = tenantIds.length > 0
      ? await this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, slug: true } })
      : [];
    const tenantMap = Object.fromEntries(tenants.map((t) => [t.id, t]));

    const enriched = items.map((log) => ({
      ...log,
      tenant: log.tenantId ? (tenantMap[log.tenantId] ?? null) : null,
    }));

    return { items: enriched, total, page, pages: Math.ceil(total / limit) };
  }

  // ── Crédits compagnies ────────────────────────────────────────────────────

  async getAllCredits() {
    const [credits, tenants] = await Promise.all([
      this.prisma.smsCredit.findMany({
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.tenant.findMany({
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Agréger par tenant
    const byTenant = new Map<string, {
      tenantId: string;
      name: string;
      slug: string;
      totalRemaining: number;
      customSender: string | null;
      credits: any[];
    }>();

    for (const tenant of tenants) {
      byTenant.set(tenant.id, {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        totalRemaining: 0,
        customSender: null,
        credits: [],
      });
    }

    for (const credit of credits) {
      const entry = byTenant.get(credit.tenantId);
      if (!entry) continue;
      entry.credits.push(credit);
      entry.totalRemaining += credit.remaining;
      if (credit.customSender && !entry.customSender) {
        entry.customSender = credit.customSender;
      }
    }

    return Array.from(byTenant.values()).sort((a, b) => b.totalRemaining - a.totalRemaining);
  }

  // ── Attribution manuelle ──────────────────────────────────────────────────

  async grantCredits(tenantId: string, smsCount: number, customSender?: string, note?: string) {
    if (smsCount <= 0) throw new BadRequestException('Le nombre de SMS doit être > 0');

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant introuvable');

    const credit = await this.prisma.smsCredit.create({
      data: {
        tenantId,
        remaining: smsCount,
        customSender: customSender?.toUpperCase() ?? null,
        expiresAt: null,
      },
    });

    // Log l'attribution dans SmsLog avec tenantId null (action système)
    await this.prisma.smsLog.create({
      data: {
        tenantId: null,
        to: 'SYSTEM',
        message: `Attribution manuelle : ${smsCount} SMS à ${tenant.name}${note ? ` — ${note}` : ''}`,
        sender: 'SUPER_ADMIN',
        status: 'sent',
        provider: 'MOCK',
        cost: 0,
      },
    });

    return credit;
  }

  // ── Statut des providers ──────────────────────────────────────────────────

  getProvidersStatus() {
    const orangeId  = this.config.get('ORANGE_SMS_CLIENT_ID', '');
    const mtnId     = this.config.get('MTN_SMS_CLIENT_ID', '');
    const atKey     = this.config.get('AFRICASTALKING_API_KEY', '');
    const atUser    = this.config.get('AFRICASTALKING_USERNAME', 'sandbox');

    return {
      primary: this.orange.isEnabled ? 'orange' : this.mtn.isEnabled ? 'mtn' : 'africastalking',
      providers: [
        {
          id: 'orange',
          label: 'Orange CI',
          configured: !!(orangeId),
          active: this.orange.isEnabled,
          sender: this.config.get('ORANGE_SMS_SENDER', 'TRANSPRO-CI'),
          order: 1,
        },
        {
          id: 'mtn',
          label: 'MTN CI',
          configured: !!(mtnId),
          active: this.mtn.isEnabled,
          sender: this.config.get('MTN_SMS_DEFAULT_SENDER', 'TRANSPRO-CI'),
          order: 2,
        },
        {
          id: 'africastalking',
          label: "Africa's Talking",
          configured: !!(atKey && atUser !== 'sandbox'),
          active: !!(atKey && atUser !== 'sandbox'),
          sender: this.config.get('AFRICASTALKING_SENDER', ''),
          order: 3,
        },
        {
          id: 'mock',
          label: 'Mock (log only)',
          configured: true,
          active: true,
          sender: '',
          order: 4,
        },
      ],
    };
  }

  // ── SMS de test ───────────────────────────────────────────────────────────

  async sendTest(to: string, message: string) {
    if (!to.startsWith('+')) throw new BadRequestException('Numéro au format international requis (+225...)');
    if (!message.trim())     throw new BadRequestException('Message vide');

    await this.router.send(to, `[TEST TRANSPRO] ${message}`);
    return { sent: true, to };
  }

  // ── Packages CRUD (super admin) ───────────────────────────────────────────

  async listPackages() {
    return this.prisma.smsPackage.findMany({
      orderBy: [{ sortOrder: 'asc' }, { priceXof: 'asc' }],
    });
  }

  async createPackage(data: {
    name: string;
    smsCount: number;
    priceXof: number;
    hasCustomSender?: boolean;
    sortOrder?: number;
  }) {
    return this.prisma.smsPackage.create({ data });
  }

  async updatePackage(id: string, data: {
    name?: string;
    smsCount?: number;
    priceXof?: number;
    hasCustomSender?: boolean;
    isActive?: boolean;
    sortOrder?: number;
  }) {
    return this.prisma.smsPackage.update({ where: { id }, data });
  }
}
