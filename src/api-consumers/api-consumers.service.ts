import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { EmailService } from '../email/email.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  API_PLAN_LIMITS,
  API_PLAN_SCOPES,
  API_PLAN_PRICING,
  ApiPlan,
  ApiScope,
  UserRole,
} from '@transpro/shared';
import {
  CreateApiConsumerDto,
  UpdateApiConsumerDto,
  CreateApiKeyDto,
} from './dto/api-consumer.dto';

const KEY_PREFIX_LENGTH = 16; // chars utilisés pour le lookup DB

function generateRawKey(environment: 'LIVE' | 'TEST' = 'LIVE'): string {
  const prefix = environment === 'TEST' ? 'tpk_test_' : 'tpk_live_';
  return `${prefix}${randomBytes(24).toString('base64url')}`;
}

function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

@Injectable()
export class ApiConsumersService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private email: EmailService,
    private config: ConfigService,
    private webhooks: WebhooksService,
  ) {}

  // ── Consumers ──────────────────────────────────────────────────────────────

  async createConsumer(dto: CreateApiConsumerDto, actorRole: string, actorTenantId?: string) {
    const existing = await this.prisma.apiConsumer.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Un consommateur avec cet email existe déjà');

    // COMPANY_OWNER ne peut créer que des consumers liés à son tenant
    if (actorRole === UserRole.COMPANY_OWNER) {
      if (dto.tenantId && dto.tenantId !== actorTenantId) {
        throw new ForbiddenException('Vous ne pouvez créer des consumers que pour votre compagnie');
      }
      dto.tenantId = actorTenantId;
    }

    return this.prisma.apiConsumer.create({
      data: {
        name:        dto.name,
        email:       dto.email,
        companyName: dto.companyName,
        plan:        dto.plan ?? ApiPlan.STARTER,
        tenantId:    dto.tenantId,
        webhookUrl:  dto.webhookUrl,
        webhookSecret: dto.webhookUrl ? generateWebhookSecret() : undefined,
        allowedIps:  dto.allowedIps ?? [],
        notes:       dto.notes,
      },
    });
  }

  async findAllConsumers(actorRole: string, actorTenantId?: string) {
    const where = actorRole === UserRole.SUPER_ADMIN
      ? {}
      : { tenantId: actorTenantId };

    return this.prisma.apiConsumer.findMany({
      where,
      include: {
        _count: { select: { keys: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneConsumer(id: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({
      where: { id },
      include: {
        keys: {
          select: {
            id: true, name: true, keyPrefix: true, environment: true, scopes: true,
            isActive: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    return consumer;
  }

  async updateConsumer(id: string, dto: UpdateApiConsumerDto, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    return this.prisma.apiConsumer.update({
      where: { id },
      data: {
        ...(dto.name       !== undefined && { name:       dto.name }),
        ...(dto.plan       !== undefined && { plan:       dto.plan }),
        ...(dto.status     !== undefined && { status:     dto.status }),
        ...(dto.webhookUrl !== undefined && { webhookUrl: dto.webhookUrl }),
        // Génère un secret si une URL webhook est définie et qu'aucun n'existe encore.
        ...(dto.webhookUrl && !consumer.webhookSecret && {
          webhookSecret: generateWebhookSecret(),
        }),
        ...(dto.allowedIps !== undefined && { allowedIps: dto.allowedIps }),
        ...(dto.notes      !== undefined && { notes:      dto.notes }),
      },
    });
  }

  // ── API Keys ───────────────────────────────────────────────────────────────

  async createKey(consumerId: string, dto: CreateApiKeyDto, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    // Valider que les scopes demandés sont couverts par le plan
    const allowedByPlan = API_PLAN_SCOPES[consumer.plan];
    const requestedScopes: ApiScope[] = dto.scopes?.length
      ? dto.scopes
      : allowedByPlan;

    const forbidden = requestedScopes.filter((s) => !allowedByPlan.includes(s));
    if (forbidden.length > 0) {
      throw new ForbiddenException(
        `Ces scopes dépassent le plan ${consumer.plan} : ${forbidden.join(', ')}`,
      );
    }

    const environment = dto.environment === 'TEST' ? 'TEST' : 'LIVE';

    // Modèle hybride : les clés LIVE exigent une validation production.
    if (environment === 'LIVE' && consumer.accessStatus !== 'APPROVED') {
      throw new ForbiddenException(
        'Accès production non activé. Demandez l’activation puis attendez la validation avant de créer une clé LIVE.',
      );
    }

    const rawKey   = generateRawKey(environment);
    const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH);
    const keyHash   = createHash('sha256').update(rawKey).digest('hex');

    await this.prisma.apiKey.create({
      data: {
        consumerId,
        name:      dto.name,
        keyPrefix,
        keyHash,
        environment,
        scopes:    requestedScopes,
        expiresAt: dto.expiresAt,
      },
    });

    // La clé brute n'est retournée QU'UNE SEULE FOIS
    return {
      key: rawKey,
      environment,
      message: 'Copiez cette clé maintenant, elle ne sera plus affichée.',
    };
  }

  /** Rotation : génère une nouvelle clé (mêmes scopes/env) ; l'ancienne expire après 24 h. */
  async rotateKey(consumerId: string, keyId: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    const old = await this.prisma.apiKey.findFirst({ where: { id: keyId, consumerId } });
    if (!old) throw new NotFoundException('Clé introuvable');

    const environment = old.environment;
    if (environment === 'LIVE' && consumer.accessStatus !== 'APPROVED') {
      throw new ForbiddenException('Accès production non activé.');
    }

    const rawKey   = generateRawKey(environment);
    const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH);
    const keyHash   = createHash('sha256').update(rawKey).digest('hex');
    const GRACE_HOURS = 24;
    const oldExpiresAt = new Date(Date.now() + GRACE_HOURS * 3600 * 1000);

    await this.prisma.$transaction([
      this.prisma.apiKey.create({
        data: { consumerId, name: old.name, keyPrefix, keyHash, environment, scopes: old.scopes },
      }),
      this.prisma.apiKey.update({ where: { id: old.id }, data: { expiresAt: oldExpiresAt } }),
    ]);

    return {
      key: rawKey,
      environment,
      oldKeyExpiresAt: oldExpiresAt,
      message: `Nouvelle clé générée. L'ancienne reste valable ${GRACE_HOURS} h pour migrer.`,
    };
  }

  /** Régénère le secret de signature webhook. */
  async regenerateWebhookSecret(consumerId: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    const webhookSecret = generateWebhookSecret();
    await this.prisma.apiConsumer.update({ where: { id: consumerId }, data: { webhookSecret } });
    return { webhookSecret };
  }

  async revokeKey(consumerId: string, keyId: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, consumerId } });
    if (!key) throw new NotFoundException('Clé introuvable');

    return this.prisma.apiKey.update({
      where: { id: keyId },
      data: { isActive: false, revokedAt: new Date() },
    });
  }

  // ── Usage & Stats ──────────────────────────────────────────────────────────

  async getUsageStats(consumerId: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const limit      = API_PLAN_LIMITS[consumer.plan];

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [totalThisMonth, byEndpoint, byDayRaw, byStatus] = await Promise.all([
      this.prisma.apiUsageLog.count({
        where: { consumerId, createdAt: { gte: monthStart } },
      }),
      this.prisma.apiUsageLog.groupBy({
        by: ['endpoint'],
        where: { consumerId, createdAt: { gte: monthStart } },
        _count: { _all: true },
        orderBy: { _count: { endpoint: 'desc' } },
        take: 10,
      }),
      // Agrégation journalière (30 derniers jours) via SQL brut.
      this.prisma.$queryRaw<Array<{ day: Date; count: number }>>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
        FROM api_usage_logs
        WHERE "consumerId" = ${consumerId} AND "createdAt" >= ${thirtyDaysAgo}
        GROUP BY day ORDER BY day ASC`,
      this.prisma.apiUsageLog.groupBy({
        by: ['statusCode'],
        where: { consumerId, createdAt: { gte: monthStart } },
        _count: { _all: true },
        orderBy: { _count: { statusCode: 'desc' } },
      }),
    ]);
    const byDay = byDayRaw.map((r) => ({
      day: (r.day instanceof Date ? r.day : new Date(r.day)).toISOString().slice(0, 10),
      count: Number(r.count),
    }));

    const quotaPercent = limit === Infinity ? 0 : Math.round((totalThisMonth / limit) * 100);

    return {
      plan: consumer.plan,
      quota: {
        used:    totalThisMonth,
        limit:   limit === Infinity ? null : limit,
        percent: quotaPercent,
        resetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      },
      topEndpoints: byEndpoint.map((e) => ({ endpoint: e.endpoint, count: e._count._all })),
      byStatus:     byStatus.map((s) => ({ statusCode: s.statusCode, count: s._count._all })),
      byDay,
    };
  }

  // ── Facturation des plans (Genius Pay) ───────────────────────────────────────

  /** Souscrit/upgrade le plan d'un consumer. Starter = gratuit ; sinon Genius Pay. */
  async subscribePlan(consumerId: string, plan: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    if (!(plan in API_PLAN_PRICING)) {
      throw new ConflictException('Plan inconnu.');
    }

    // Starter (gratuit) : appliqué immédiatement, sans paiement.
    if (plan === ApiPlan.STARTER || API_PLAN_PRICING[plan as ApiPlan].priceMonthly <= 0) {
      await this.prisma.apiConsumer.update({
        where: { id: consumerId },
        data: { plan: plan as ApiPlan, planExpiresAt: null },
      });
      return { free: true, plan };
    }

    return this.billing.initiateApiPlanPayment(
      { id: consumer.id, name: consumer.name, email: consumer.email, plan: consumer.plan },
      plan as ApiPlan,
    );
  }

  /** Confirme un paiement de plan depuis la redirection post-paiement. */
  async confirmPlanFromRedirect(consumerId: string, paymentId: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);
    return this.billing.confirmApiPlanFromRedirect(paymentId, consumerId);
  }

  // ── Activation production (modèle hybride) ───────────────────────────────────

  /** L'owner demande l'activation de l'accès production (clés LIVE). */
  async requestProduction(consumerId: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    if (consumer.accessStatus === 'APPROVED') {
      throw new ConflictException('Accès production déjà activé.');
    }
    if (consumer.accessStatus === 'PENDING') {
      throw new ConflictException('Demande déjà en attente de validation.');
    }

    return this.prisma.apiConsumer.update({
      where: { id: consumerId },
      data: {
        accessStatus: 'PENDING',
        prodRequestedAt: new Date(),
        prodRejectionReason: null,
      },
    });
  }

  /** Un SUPER_ADMIN approuve ou rejette une demande d'activation production. */
  async reviewProduction(
    consumerId: string,
    approve: boolean,
    actorRole: string,
    reason?: string,
  ) {
    if (actorRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Réservé aux administrateurs.');
    }
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');

    const updated = await this.prisma.apiConsumer.update({
      where: { id: consumerId },
      data: {
        accessStatus: approve ? 'APPROVED' : 'REJECTED',
        prodReviewedAt: new Date(),
        prodRejectionReason: approve ? null : (reason ?? 'Non précisé'),
      },
    });

    if (consumer.email) {
      const appUrl = this.config.get('FRONTEND_URL') || this.config.get('APP_URL') || 'http://localhost:3000';
      const dashUrl = `${appUrl}/dashboard/developers`;
      const send = approve
        ? this.email.sendApiProductionApproved(consumer.email, consumer.name, dashUrl)
        : this.email.sendApiProductionRejected(consumer.email, consumer.name, reason ?? 'Non précisé', dashUrl);
      send.catch(() => {});
    }

    return updated;
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────────

  async listWebhookDeliveries(consumerId: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    return this.prisma.webhookDelivery.findMany({
      where: { consumerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, event: true, url: true, status: true, attempts: true,
        statusCode: true, lastError: true, nextRetryAt: true,
        deliveredAt: true, createdAt: true,
      },
    });
  }

  /** Relance manuellement une livraison de webhook du consumer. */
  async resendWebhook(consumerId: string, deliveryId: string, actorRole: string, actorTenantId?: string) {
    const consumer = await this.prisma.apiConsumer.findUnique({ where: { id: consumerId } });
    if (!consumer) throw new NotFoundException('Consommateur introuvable');
    this.assertAccess(consumer, actorRole, actorTenantId);

    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, consumerId },
      select: { id: true },
    });
    if (!delivery) throw new NotFoundException('Livraison introuvable');

    await this.webhooks.resend(deliveryId);
    return { queued: true };
  }

  // ── Accès ──────────────────────────────────────────────────────────────────

  private assertAccess(consumer: { tenantId: string | null }, actorRole: string, actorTenantId?: string) {
    if (actorRole === UserRole.SUPER_ADMIN) return;
    if (actorRole === UserRole.COMPANY_OWNER && consumer.tenantId === actorTenantId) return;
    throw new ForbiddenException('Accès refusé');
  }
}
