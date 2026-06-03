import { Module } from '@nestjs/common';
import { AdminSmsController } from './admin-sms.controller';
import { AdminSmsService } from './admin-sms.service';
import { SmsModule } from '../sms/sms.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [SmsModule, PrismaModule],
  controllers: [AdminSmsController],
  providers: [AdminSmsService],
})
export class AdminSmsModule {}
