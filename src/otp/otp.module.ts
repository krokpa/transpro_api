import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    JwtModule.register({}),
    SmsModule,
  ],
  controllers: [OtpController],
  providers: [OtpService],
  exports: [OtpService],
})
export class OtpModule {}
