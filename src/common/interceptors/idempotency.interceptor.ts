import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Observable, of, concatMap, catchError, throwError } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Idempotence pour les POST de l'API publique.
 * Le client envoie un header `Idempotency-Key`; un rejeu avec la même clé (et le
 * même consumer) renvoie la réponse mémorisée au lieu de recréer la ressource.
 * Les enregistrements expirent après 24 h.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const key: string | undefined = req.headers['idempotency-key'];
    const consumerId: string | undefined = req.apiConsumer?.id;

    // S'applique uniquement aux POST authentifiés portant une clé d'idempotence.
    if (req.method !== 'POST' || !key || !consumerId) {
      return next.handle();
    }

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { consumerId_key: { consumerId, key } },
    });

    if (existing) {
      if (existing.statusCode > 0 && existing.responseBody !== null) {
        // Rejeu : renvoyer la réponse mémorisée (re-emballée par TransformInterceptor).
        return of(existing.responseBody);
      }
      // Une requête avec la même clé est encore en cours de traitement.
      throw new ConflictException('Requête idempotente déjà en cours de traitement.');
    }

    // Réserver la clé (la contrainte unique gère les courses concurrentes).
    try {
      await this.prisma.idempotencyKey.create({
        data: { consumerId, key, method: req.method, path: req.url ?? '', statusCode: 0 },
      });
    } catch {
      throw new ConflictException('Requête idempotente déjà en cours de traitement.');
    }

    return next.handle().pipe(
      // Persiste la réponse AVANT de l'émettre, pour qu'un rejeu immédiat la
      // retrouve (évite la fenêtre de course du fire-and-forget).
      concatMap(async (body) => {
        await this.prisma.idempotencyKey
          .update({
            where: { consumerId_key: { consumerId, key } },
            data: { statusCode: 201, responseBody: body ?? {} },
          })
          .catch((e) => this.logger.warn(`Idempotency store failed: ${e?.message}`));
        return body;
      }),
      catchError((err) => {
        // Échec → libérer la clé pour permettre un nouvel essai.
        this.prisma.idempotencyKey
          .delete({ where: { consumerId_key: { consumerId, key } } })
          .catch(() => {});
        return throwError(() => err);
      }),
    );
  }

  /** Purge quotidienne des clés de plus de 24 h. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanup() {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
    await this.prisma.idempotencyKey
      .deleteMany({ where: { createdAt: { lt: cutoff } } })
      .catch(() => {});
  }
}
