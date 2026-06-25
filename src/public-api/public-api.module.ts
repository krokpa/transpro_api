import { Module } from '@nestjs/common';
import { PublicApiService } from './public-api.service';
import { PublicApiController } from './public-api.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { BookingsModule } from '../bookings/bookings.module';
import { ParcelsModule } from '../parcels/parcels.module';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Module({
  imports: [PrismaModule, PaymentsModule, WebhooksModule, BookingsModule, ParcelsModule],
  providers: [PublicApiService, IdempotencyInterceptor],
  controllers: [PublicApiController],
})
export class PublicApiModule {}
