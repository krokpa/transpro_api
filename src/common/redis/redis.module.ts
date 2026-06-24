import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RateLimitService } from './rate-limit.service';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = new Redis(config.get('REDIS_URL', 'redis://localhost:6379'), {
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          lazyConnect: false,
        });
        // Évite un crash sur 'error' non géré quand Redis est indisponible.
        client.on('error', () => {});
        return client;
      },
    },
    RateLimitService,
  ],
  exports: [REDIS_CLIENT, RateLimitService],
})
export class RedisModule {}
