import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { OtpService } from './otp.service';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';

@Controller('v1/otp')
@UseGuards(ThrottlerGuard)
export class OtpController {
  constructor(private readonly otp: OtpService) {}

  @Post('send')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async send(@Body() dto: SendOtpDto) {
    await this.otp.send(dto.phone);
    return { message: 'Code OTP envoyé par SMS.' };
  }

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verify(@Body() dto: VerifyOtpDto) {
    const phoneVerificationToken = await this.otp.verify(dto.phone, dto.code);
    return { phoneVerificationToken };
  }
}
