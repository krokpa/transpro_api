import { Module } from '@nestjs/common';
import { PublicApiService } from './public-api.service';
import { PublicApiController } from './public-api.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Module({
  imports: [PrismaModule, PaymentsModule, WebhooksModule],
  providers: [PublicApiService, IdempotencyInterceptor],
  controllers: [PublicApiController],
})
export class PublicApiModule {}
