import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

// Burst : nombre max de requêtes par fenêtre courte et par clé API.
const BURST_LIMIT = 60;
const BURST_WINDOW_SEC = 10;

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Limite de rafale par clé API (fenêtre fixe). Fail-open si Redis indisponible.
   * Retourne { allowed, retryAfter } — retryAfter en secondes si bloqué.
   */
  async consumeBurst(apiKeyId: string): Promise<{ allowed: boolean; retryAfter: number }> {
    try {
      const key = `rl:burst:${apiKeyId}`;
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, BURST_WINDOW_SEC);
      if (count > BURST_LIMIT) {
        const ttl = await this.redis.ttl(key);
        return { allowed: false, retryAfter: ttl > 0 ? ttl : BURST_WINDOW_SEC };
      }
      return { allowed: true, retryAfter: 0 };
    } catch (e) {
      this.logger.warn(`Burst limiter unavailable (fail-open): ${(e as Error).message}`);
      return { allowed: true, retryAfter: 0 };
    }
  }

  /**
   * Compteur de quota mensuel via Redis. À froid (clé absente), initialise depuis
   * la base (backfill) puis incrémente. Renvoie le total courant, ou null si Redis
   * est indisponible (l'appelant retombe alors sur le COUNT DB).
   */
  async consumeMonthly(
    consumerId: string,
    monthKey: string,
    resetEpoch: number,
    backfill: () => Promise<number>,
  ): Promise<number | null> {
    try {
      const key = `rl:quota:${consumerId}:${monthKey}`;
      const count = await this.redis.incr(key);
      if (count === 1) {
        // Clé fraîche : ajouter l'historique du mois déjà présent en base.
        const dbCount = await backfill();
        const total = await this.redis.incrby(key, dbCount);
        await this.redis.expireat(key, resetEpoch);
        return total;
      }
      return count;
    } catch (e) {
      this.logger.warn(`Quota counter unavailable (fallback to DB): ${(e as Error).message}`);
      return null;
    }
  }
}
