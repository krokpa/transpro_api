import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  API_PLAN_LIMITS,
  API_PLAN_SCOPES,
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
  constructor(private prisma: PrismaService) {}

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

    const [totalThisMonth, byEndpoint, byDay, byStatus] = await Promise.all([
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
      this.prisma.apiUsageLog.groupBy({
        by: ['createdAt'],
        where: { consumerId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
        _count: { _all: true },
      }),
      this.prisma.apiUsageLog.groupBy({
        by: ['statusCode'],
        where: { consumerId, createdAt: { gte: monthStart } },
        _count: { _all: true },
        orderBy: { _count: { statusCode: 'desc' } },
      }),
    ]);

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

    return this.prisma.apiConsumer.update({
      where: { id: consumerId },
      data: {
        accessStatus: approve ? 'APPROVED' : 'REJECTED',
        prodReviewedAt: new Date(),
        prodRejectionReason: approve ? null : (reason ?? 'Non précisé'),
      },
    });
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

  // ── Accès ──────────────────────────────────────────────────────────────────

  private assertAccess(consumer: { tenantId: string | null }, actorRole: string, actorTenantId?: string) {
    if (actorRole === UserRole.SUPER_ADMIN) return;
    if (actorRole === UserRole.COMPANY_OWNER && consumer.tenantId === actorTenantId) return;
    throw new ForbiddenException('Accès refusé');
  }
}
