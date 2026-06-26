import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushModule } from '../push/push.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [ConfigModule, RealtimeModule, PaymentsModule, NotificationsModule, PushModule, WebhooksModule, SmsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
