import { Controller, Get, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';
import * as crypto from 'crypto';
import * as fs from 'fs';

class QzSignDto {
  @IsString()
  request: string;
}

@ApiTags('QZ Tray')
@Controller({ path: 'qz', version: '1' })
export class QzController {
  private readonly certificate: string;
  private readonly privateKey: string;

  constructor(private config: ConfigService) {
    const certPath = config.get<string>('QZ_CERT_PATH');
    const certContent = config.get<string>('QZ_CERTIFICATE', '');
    this.certificate = certPath && fs.existsSync(certPath)
      ? fs.readFileSync(certPath, 'utf8').trim()
      : certContent.replace(/\\n/g, '\n').trim();

    const keyPath = config.get<string>('QZ_PRIVATE_KEY_PATH');
    const keyContent = config.get<string>('QZ_PRIVATE_KEY', '');
    this.privateKey = keyPath && fs.existsSync(keyPath)
      ? fs.readFileSync(keyPath, 'utf8').trim()
      : keyContent.replace(/\\n/g, '\n').trim();
  }

  // Pas de guard — le certificat est une clé publique, sans risque
  @Get('certificate')
  @ApiOperation({ summary: 'Certificat QZ Tray (public)' })
  getCertificate() {
    return { certificate: this.certificate };
  }

  @Post('sign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Signe une requête QZ Tray côté serveur' })
  sign(@Body() dto: QzSignDto) {
    if (!this.privateKey) {
      throw new BadRequestException(
        'QZ_PRIVATE_KEY non configuré — ajoutez la variable dans .env',
      );
    }
    const signer = crypto.createSign('SHA512');
    signer.update(dto.request);
    const signature = signer.sign(this.privateKey, 'base64');
    return { signature };
  }
}
