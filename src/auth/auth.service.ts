import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto, LoginDto } from './dto/register.dto';
import { JwtPayload, AuthTokens } from '@transpro/shared';
import { nanoid } from 'nanoid';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private email: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { phone: dto.phone }] },
    });
    if (existing) {
      throw new ConflictException('Email ou téléphone déjà utilisé');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash,
        role: dto.role ?? 'PASSENGER',
      },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role as any, user.tenantId ?? undefined);
    return { user, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        userStations: {
          where: { station: { isActive: true } },
          include: { station: { select: { id: true, name: true, code: true, isActive: true, city: { select: { name: true } } } } },
          orderBy: { isPrimary: 'desc' },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { passwordHash: _, ...userWithoutPassword } = user;
    const tokens = await this.generateTokens(user.id, user.email, user.role as any, user.tenantId ?? undefined);
    return { user: userWithoutPassword, ...tokens };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Token de rafraîchissement invalide ou expiré');
    }

    await this.prisma.refreshToken.delete({ where: { id: stored.id } });

    return this.generateTokens(
      stored.user.id,
      stored.user.email,
      stored.user.role as any,
      stored.user.tenantId ?? undefined,
    );
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId, token: refreshToken },
      });
    } else {
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }
    return { message: 'Déconnexion réussie' };
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        isActive: true,
        isVerified: true,
        preferredLang: true,
        createdAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            plan: true,
            status: true,
          },
        },
        userStations: {
          include: {
            station: { select: { id: true, name: true, city: { select: { name: true } }, code: true, isActive: true } },
          },
        },
      },
    });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Réponse générique pour ne pas révéler si l'email existe
    if (!user || !user.isActive) {
      return { message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' };
    }

    // Invalider les anciens tokens
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const rawToken = nanoid(48);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 heure

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, token: rawToken, expiresAt },
    });

    const appUrl = this.config.get('APP_URL', 'http://localhost:3000');
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

    await this.email.sendPasswordReset(user.email, user.firstName, resetUrl);

    return { message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { token } });

    if (!record || record.expiresAt < new Date() || record.usedAt) {
      throw new BadRequestException('Lien de réinitialisation invalide ou expiré');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Forcer la reconnexion sur tous les appareils
      this.prisma.refreshToken.deleteMany({ where: { userId: record.userId } }),
    ]);

    return { message: 'Mot de passe réinitialisé avec succès' };
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: any,
    tenantId?: string,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email, role, tenantId };

    const [accessToken, rawRefresh] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_EXPIRES_IN', '7d'),
      }),
      Promise.resolve(nanoid(64)),
    ]);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.prisma.refreshToken.create({
      data: { userId, token: rawRefresh, expiresAt },
    });

    return { accessToken, refreshToken: rawRefresh };
  }
}
