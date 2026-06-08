import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SCOPES_KEY } from '../decorators/require-scope.decorator';
import { API_PLAN_LIMITS, API_PLAN_SCOPES, ApiScope } from '@transpro/shared';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey: string | undefined = request.headers['x-api-key'];

    if (!rawKey) {
      throw new UnauthorizedException('Clé API manquante (header X-API-Key requis)');
    }

    // Lookup par prefix (12 premiers chars) puis vérification par hash complet
    const keyPrefix = rawKey.substring(0, 16);
    const keyHash   = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.prisma.apiKey.findFirst({
      where: { keyPrefix },
      include: { consumer: true },
    });

    if (!apiKey || apiKey.keyHash !== keyHash) {
      throw new UnauthorizedException('Clé API invalide');
    }

    if (!apiKey.isActive || apiKey.revokedAt) {
      throw new UnauthorizedException('Clé API révoquée');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('Clé API expirée');
    }

    const consumer = apiKey.consumer;

    if (consumer.status !== 'ACTIVE') {
      throw new ForbiddenException('Compte API suspendu ou annulé');
    }

    // Vérification IP whitelist
    if (consumer.allowedIps.length > 0) {
      const clientIp = request.ip ?? request.headers['x-forwarded-for']?.split(',')[0]?.trim();
      if (!clientIp || !consumer.allowedIps.includes(clientIp)) {
        throw new ForbiddenException(`IP non autorisée : ${clientIp}`);
      }
    }

    // Vérification quota mensuel
    const limit = API_PLAN_LIMITS[consumer.plan];
    if (limit !== Infinity) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const usageThisMonth = await this.prisma.apiUsageLog.count({
        where: { consumerId: consumer.id, createdAt: { gte: monthStart } },
      });

      if (usageThisMonth >= limit) {
        throw new ForbiddenException(
          `Quota mensuel atteint (${limit.toLocaleString()} req/${consumer.plan}). Passez à un plan supérieur.`,
        );
      }
    }

    // Vérification scopes requis par la route
    const requiredScopes = this.reflector.getAllAndOverride<ApiScope[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredScopes?.length) {
      const allowedByPlan  = API_PLAN_SCOPES[consumer.plan];
      const allowedByKey   = apiKey.scopes.length > 0 ? apiKey.scopes : allowedByPlan;
      const missing = requiredScopes.filter(
        (s) => !allowedByPlan.includes(s) || !allowedByKey.includes(s),
      );
      if (missing.length > 0) {
        throw new ForbiddenException(`Scope(s) insuffisant(s) : ${missing.join(', ')}`);
      }
    }

    // Mise à jour lastUsedAt (fire-and-forget)
    this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    // Injecter le consommateur dans la requête
    request.apiConsumer = consumer;
    request.apiKey      = apiKey;

    return true;
  }
}
