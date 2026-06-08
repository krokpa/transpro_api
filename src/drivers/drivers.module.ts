import { Module } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { OtpModule } from '../otp/otp.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [OtpModule, SmsModule],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
