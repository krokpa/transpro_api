import { Module } from '@nestjs/common';
import { SmsPackagesController } from './sms-packages.controller';
import { SmsPackagesService } from './sms-packages.service';

@Module({
  controllers: [SmsPackagesController],
  providers: [SmsPackagesService],
  exports: [SmsPackagesService],
})
export class SmsPackagesModule {}
