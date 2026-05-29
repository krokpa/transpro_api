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
import * as crypto from 'crypto';
import { generateSecret, generateSync, verifySync, generateURI } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto, LoginDto } from './dto/register.dto';
import { JwtPayload, AuthTokens, PERM } from '@transpro/shared';
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

    // 2FA actif → retourner un token de challenge temporaire
    if (user.totpEnabled) {
      const twoFactorToken = await this.jwt.signAsync(
        { sub: user.id, type: '2fa_required' },
        { secret: this.config.get('JWT_SECRET'), expiresIn: '5m' },
      );
      return { requires2fa: true, twoFactorToken };
    }

    const { passwordHash: _, ...userWithoutPassword } = user;
    const tokens = await this.generateTokens(user.id, user.email, user.role as any, user.tenantId ?? undefined);
    return { user: userWithoutPassword, ...tokens };
  }

  async verifyTotpLogin(twoFactorToken: string, code: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(twoFactorToken, {
        secret: this.config.get('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Token 2FA invalide ou expiré');
    }

    if (payload.type !== '2fa_required') {
      throw new UnauthorizedException('Token 2FA invalide');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userStations: {
          where: { station: { isActive: true } },
          include: { station: { select: { id: true, name: true, code: true, isActive: true, city: { select: { name: true } } } } },
          orderBy: { isPrimary: 'desc' },
        },
      },
    });

    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
      throw new UnauthorizedException('Utilisateur invalide');
    }

    // Vérifier code TOTP
    const totpResult = verifySync({ token: code, secret: user.totpSecret });
    const isValidTotp = typeof totpResult === 'object' ? totpResult.valid : totpResult;

    // Sinon, tenter les codes de secours
    if (!isValidTotp) {
      const matchIdx = await this.findBackupCode(user.totpBackupCodes, code);
      if (matchIdx === -1) {
        throw new UnauthorizedException('Code incorrect');
      }
      // Consommer le code de secours
      const newCodes = [...user.totpBackupCodes];
      newCodes.splice(matchIdx, 1);
      await this.prisma.user.update({ where: { id: user.id }, data: { totpBackupCodes: newCodes } });
    }

    const { passwordHash: _, totpSecret: __, totpBackupCodes: ___, ...userWithoutSecrets } = user;
    const tokens = await this.generateTokens(user.id, user.email, user.role as any, user.tenantId ?? undefined);
    return { user: userWithoutSecrets, ...tokens };
  }

  async generateTotpSetup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.totpEnabled) throw new BadRequestException('Le 2FA est déjà activé');

    const secret = generateSecret();
    const otpAuthUri = generateURI({ label: user.email, issuer: 'TransPro CI', secret });

    // Stocker le secret temporairement (pas encore activé)
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });

    return { secret, otpAuthUri };
  }

  async enableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.totpEnabled) throw new BadRequestException('Le 2FA est déjà activé');
    if (!user.totpSecret) throw new BadRequestException('Lance /auth/2fa/setup d\'abord');

    const verifyResult = verifySync({ token: code, secret: user.totpSecret });
    const isValid = typeof verifyResult === 'object' ? verifyResult.valid : verifyResult;
    if (!isValid) throw new BadRequestException('Code TOTP incorrect');

    // Générer 10 codes de secours
    const backupCodes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase(),
    );
    const hashedCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true, totpBackupCodes: hashedCodes },
    });

    return {
      message: '2FA activé avec succès',
      backupCodes,
    };
  }

  async disableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (!user.totpEnabled || !user.totpSecret) {
      throw new BadRequestException('Le 2FA n\'est pas activé');
    }

    const disableVerifyResult = verifySync({ token: code, secret: user.totpSecret });
    const isValidDisable = typeof disableVerifyResult === 'object' ? disableVerifyResult.valid : disableVerifyResult;
    if (!isValidDisable) {
      const matchIdx = await this.findBackupCode(user.totpBackupCodes, code);
      if (matchIdx === -1) throw new BadRequestException('Code incorrect');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
    });

    return { message: '2FA désactivé' };
  }

  private async loadUserPermissions(userId: string, role: string): Promise<string[]> {
    if (role === 'SUPER_ADMIN') return Object.values(PERM);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        companyProfile: {
          select: { permissions: { select: { permissionCode: true } } },
        },
        userStations: {
          select: {
            stationProfile: {
              select: { permissions: { select: { permissionCode: true } } },
            },
          },
        },
      },
    });

    const companyPerms = user?.companyProfile?.permissions.map((p) => p.permissionCode) ?? [];
    const stationPerms = user?.userStations.flatMap(
      (s) => s.stationProfile?.permissions.map((p) => p.permissionCode) ?? [],
    ) ?? [];

    return [...new Set([...companyPerms, ...stationPerms])];
  }

  private async findBackupCode(hashedCodes: string[], code: string): Promise<number> {
    for (let i = 0; i < hashedCodes.length; i++) {
      const match = await bcrypt.compare(code, hashedCodes[i]);
      if (match) return i;
    }
    return -1;
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
    // Charger les permissions RBAC pour le JWT
    const perms = await this.loadUserPermissions(userId, role);
    const payload: JwtPayload = { sub: userId, email, role, tenantId, perms };

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
