import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@transpro/shared';
import { RegisterDeveloperDto } from './dto/register-developer.dto';

@Injectable()
export class DevelopersService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private email: EmailService,
    private config: ConfigService,
  ) {}

  /** Crée un token de vérification email et envoie le lien. */
  private async sendVerification(userId: string, email: string, name: string) {
    await this.prisma.emailVerificationToken.deleteMany({ where: { userId } });
    const token = nanoid(48);
    await this.prisma.emailVerificationToken.create({
      data: { userId, token, expiresAt: new Date(Date.now() + 24 * 3600 * 1000) },
    });
    const appUrl = this.config.get('FRONTEND_URL') || this.config.get('APP_URL') || 'http://localhost:3000';
    await this.email.sendEmailVerification(email, name, `${appUrl}/developer/verify?token=${token}`).catch(() => {});
  }

  /**
   * Inscription self-service d'un développeur tiers (hors compagnie).
   * Crée un User(role DEVELOPER) + un ApiConsumer en sandbox lié, puis renvoie
   * directement les jetons de session (l'utilisateur est connecté).
   */
  async register(dto: RegisterDeveloperDto) {
    const email = dto.email.toLowerCase().trim();

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new ConflictException('Un compte existe déjà avec cet email.');
    const existingConsumer = await this.prisma.apiConsumer.findUnique({ where: { email } });
    if (existingConsumer) throw new ConflictException('Un accès API existe déjà avec cet email.');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const parts = dto.name.trim().split(' ');
    const firstName = parts.shift() || dto.name;
    const lastName = parts.join(' ') || '-';

    const user = await this.prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        role: UserRole.DEVELOPER,
        passwordHash,
        isActive: true,
        isVerified: false,
      },
    });

    await this.prisma.apiConsumer.create({
      data: {
        name: dto.name,
        email,
        companyName: dto.companyName,
        plan: 'STARTER',
        accessStatus: 'SANDBOX',
        ownerUserId: user.id,
        allowedIps: [],
      },
    });

    await this.sendVerification(user.id, email, firstName);

    // Connexion immédiate : renvoie { user, accessToken, refreshToken }.
    return this.auth.login({ email, password: dto.password });
  }

  /** Vérifie l'email via le token reçu par lien. */
  async verifyEmail(token: string) {
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { token } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Lien de vérification invalide ou expiré.');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { isVerified: true } }),
      this.prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    return { verified: true };
  }

  /** Renvoie un email de vérification au développeur connecté. */
  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.isVerified) return { alreadyVerified: true };
    await this.sendVerification(user.id, user.email, user.firstName);
    return { sent: true };
  }
}
