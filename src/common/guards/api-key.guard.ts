import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
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

  /** Définit un header de réponse (compatible adaptateur Fastify ou Express). */
  private setHeader(res: any, name: string, value: string | number) {
    if (typeof res?.header === 'function') res.header(name, value);
    else if (typeof res?.setHeader === 'function') res.setHeader(name, value);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
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

    // Vérification quota mensuel + headers X-RateLimit-*
    const limit = API_PLAN_LIMITS[consumer.plan];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    const resetEpoch = Math.floor(monthEnd.getTime() / 1000);

    if (limit === Infinity) {
      this.setHeader(response, 'X-RateLimit-Limit', 'unlimited');
      this.setHeader(response, 'X-RateLimit-Remaining', 'unlimited');
      this.setHeader(response, 'X-RateLimit-Reset', resetEpoch);
    } else {
      const usageThisMonth = await this.prisma.apiUsageLog.count({
        where: { consumerId: consumer.id, createdAt: { gte: monthStart } },
      });
      const remaining = Math.max(0, limit - usageThisMonth);

      this.setHeader(response, 'X-RateLimit-Limit', limit);
      this.setHeader(response, 'X-RateLimit-Remaining', remaining);
      this.setHeader(response, 'X-RateLimit-Reset', resetEpoch);

      if (usageThisMonth >= limit) {
        const retryAfter = Math.max(1, resetEpoch - Math.floor(now.getTime() / 1000));
        this.setHeader(response, 'Retry-After', retryAfter);
        throw new HttpException(
          `Quota mensuel atteint (${limit.toLocaleString()} req/${consumer.plan}). Passez à un plan supérieur.`,
          HttpStatus.TOO_MANY_REQUESTS,
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
