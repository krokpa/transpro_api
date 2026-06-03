import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { MtnSmsService } from './mtn-sms.service';
import { OrangeSmsService } from './orange-sms.service';
import { SmsRouterService } from './sms-router.service';

@Module({
  providers: [OrangeSmsService, MtnSmsService, SmsService, SmsRouterService],
  exports:   [OrangeSmsService, MtnSmsService, SmsService, SmsRouterService],
})
export class SmsModule {}
