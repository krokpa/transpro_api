import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { MtnSmsService } from './mtn-sms.service';
import { SmsRouterService } from './sms-router.service';

@Module({
  providers: [SmsService, MtnSmsService, SmsRouterService],
  exports: [SmsService, MtnSmsService, SmsRouterService],
})
export class SmsModule {}
