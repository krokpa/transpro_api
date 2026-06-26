import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { SmsRouterService } from '../sms/sms-router.service';

const OTP_TTL_MINUTES = 10;
const MAX_SEND_PER_WINDOW = 3;      // 3 envois max par 10 min
const MAX_VERIFY_ATTEMPTS = 5;      // 5 tentatives de saisie max par OTP

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private prisma: PrismaService,
    private smsRouter: SmsRouterService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async send(phone: string): Promise<void> {
    // Rate-limit : compter les OTP non expirés envoyés dans les 10 dernières minutes
    const windowStart = new Date(Date.now() - OTP_TTL_MINUTES * 60 * 1000);
    const recentCount = await this.prisma.phoneOtp.count({
      where: { phone, createdAt: { gte: windowStart } },
    });
    if (recentCount >= MAX_SEND_PER_WINDOW) {
      throw new HttpException(
        'Trop de tentatives. Attendez quelques minutes avant de réessayer.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Invalider les OTP précédents non utilisés
    await this.prisma.phoneOtp.updateMany({
      where: { phone, used: false },
      data: { used: true },
    });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.phoneOtp.create({
      data: { phone, codeHash, expiresAt },
    });

    const message = `{APP} - Votre code de vérification est : ${code}. Valable ${OTP_TTL_MINUTES} minutes. Ne le communiquez à personne.`;
    await this.smsRouter.send(phone, message);

    this.logger.log(`OTP envoyé à ${phone}`);
  }

  async verify(phone: string, code: string): Promise<string> {
    const otp = await this.prisma.phoneOtp.findFirst({
      where: {
        phone,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException('Aucun code actif pour ce numéro. Demandez un nouveau code.');
    }

    if (otp.attempts >= MAX_VERIFY_ATTEMPTS) {
      await this.prisma.phoneOtp.update({ where: { id: otp.id }, data: { used: true } });
      throw new BadRequestException('Trop de tentatives incorrectes. Demandez un nouveau code.');
    }

    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      await this.prisma.phoneOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = MAX_VERIFY_ATTEMPTS - otp.attempts - 1;
      throw new BadRequestException(
        remaining > 0
          ? `Code incorrect. ${remaining} tentative(s) restante(s).`
          : 'Code incorrect. Veuillez demander un nouveau code.',
      );
    }

    await this.prisma.phoneOtp.update({ where: { id: otp.id }, data: { used: true } });

    // Token signé court-terme prouvant que ce numéro a été vérifié
    const token = await this.jwt.signAsync(
      { phone, type: 'phone_verified' },
      { secret: this.config.get('JWT_SECRET'), expiresIn: '15m' },
    );

    return token;
  }

  /** Valide un phoneVerificationToken et retourne le numéro vérifié. */
  async validateToken(token: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get('JWT_SECRET'),
      });
      if (payload?.type !== 'phone_verified') throw new Error('type mismatch');
      return payload.phone as string;
    } catch {
      throw new BadRequestException('Token de vérification téléphone invalide ou expiré.');
    }
  }
}
