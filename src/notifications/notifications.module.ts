import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { DepartureRemindersService } from './departure-reminders.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [RealtimeModule, PrismaModule, PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, DepartureRemindersService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
