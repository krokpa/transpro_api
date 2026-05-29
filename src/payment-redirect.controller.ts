import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class PaymentRedirectController {
  constructor(private config: ConfigService) {}

  @Public()
  @Get('passenger/payment/success')
  success(@Query() query: Record<string, string>, @Res() reply: FastifyReply) {
    const base = this.config.get('FRONTEND_URL', 'http://localhost:3000');
    const params = new URLSearchParams(query).toString();
    return reply.redirect(302, `${base}/passenger/payment/success?${params}`);
  }

  @Public()
  @Get('passenger/payment/error')
  error(@Query() query: Record<string, string>, @Res() reply: FastifyReply) {
    const base = this.config.get('FRONTEND_URL', 'http://localhost:3000');
    const params = new URLSearchParams(query).toString();
    return reply.redirect(302, `${base}/passenger/payment/error?${params}`);
  }
}
