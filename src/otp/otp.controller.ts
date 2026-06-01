import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { OtpService } from './otp.service';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';

@Controller('v1/otp')
export class OtpController {
  constructor(private readonly otp: OtpService) {}

  @Post('send')
  @HttpCode(200)
  async send(@Body() dto: SendOtpDto) {
    await this.otp.send(dto.phone);
    return { message: 'Code OTP envoyé par SMS.' };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() dto: VerifyOtpDto) {
    const phoneVerificationToken = await this.otp.verify(dto.phone, dto.code);
    return { phoneVerificationToken };
  }
}
