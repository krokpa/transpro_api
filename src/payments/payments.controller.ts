import {
  Controller, Get, Post, Body, Param, UseGuards, HttpCode, HttpStatus,
  Headers, Patch, Req,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';

class ConfirmNativeDto {
  @IsString() @IsNotEmpty()
  geniusPayReference: string;
}
import { FastifyRequest } from 'fastify';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Paiements')
@Controller({ path: 'payments', version: '1' })
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Get('my')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Historique des paiements du passager connecté' })
  myPayments(@CurrentUser('id') userId: string) {
    return this.payments.findByPassenger(userId);
  }

  @Patch(':paymentId/check-status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Vérifier le statut d\'un paiement via Genius Pay' })
  checkStatus(
    @Param('paymentId') paymentId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.checkStatus(paymentId, userId);
  }

  @Patch('bookings/:bookingId/check-status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Vérifier le statut du paiement d\'une réservation via Genius Pay' })
  checkStatusByBooking(
    @Param('bookingId') bookingId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.checkStatusByBooking(bookingId, userId);
  }

  @Post('bookings/:bookingId/confirm-from-redirect')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmer le paiement depuis la redirection Genius Pay' })
  confirmFromRedirect(
    @Param('bookingId') bookingId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.confirmFromRedirect(bookingId, userId);
  }

  @Post('bookings/:bookingId/pay')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initier le paiement via Genius Pay (legacy WebView)' })
  initiate(
    @Param('bookingId') bookingId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.initiate(bookingId, userId);
  }

  @Post('bookings/:bookingId/confirm-native')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmer un paiement effectué via le SDK natif GeniusPay' })
  confirmNative(
    @Param('bookingId') bookingId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmNativeDto,
  ) {
    return this.payments.confirmNative(bookingId, userId, dto.geniusPayReference);
  }

  @Public()
  @Get('geniuspay/webhook')
  @Post('geniuspay/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook Genius Pay' })
  geniuspayWebhook(
    @Req() req: FastifyRequest,
    @Headers('x-webhook-signature') signature: string,
    @Headers('x-webhook-timestamp') timestamp: string,
  ) {
    const rawBody = (req as any).rawBody ?? JSON.stringify((req as any).body ?? {});
    return this.payments.handleGeniusPayWebhook(rawBody, signature, timestamp);
  }

  @Post('tickets/scan')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Scanner un billet QR code' })
  scanTicket(@Body('qrData') qrData: string, @CurrentUser('id') agentId: string) {
    return this.payments.scanTicket(qrData, agentId);
  }

  @Patch('tickets/:ticketId/check-in')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pointer un passager (check-in manuel)' })
  checkIn(@Param('ticketId') ticketId: string, @CurrentUser('id') agentId: string) {
    return this.payments.checkInTicket(ticketId, agentId);
  }
}
