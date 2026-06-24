import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DevelopersService } from './developers.service';
import { RegisterDeveloperDto } from './dto/register-developer.dto';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Développeurs (inscription)')
@Controller({ path: 'developer', version: '1' })
export class DevelopersController {
  constructor(private readonly developers: DevelopersService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Inscription self-service d\'un développeur tiers' })
  register(@Body() dto: RegisterDeveloperDto) {
    return this.developers.register(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifier l\'email via le token reçu par lien' })
  verifyEmail(@Body() dto: { token: string }) {
    return this.developers.verifyEmail(dto?.token);
  }

  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renvoyer l\'email de vérification (développeur connecté)' })
  resendVerification(@CurrentUser('id') userId: string) {
    return this.developers.resendVerification(userId);
  }
}
