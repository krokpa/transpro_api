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
import { OtpService } from '../otp/otp.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { RegisterDto, LoginDto, LoginByPhoneDto } from './dto/register.dto';
import { JwtPayload, AuthTokens, PERM, SYSTEM_PROFILES, UserRole } from '@transpro/shared';
import { nanoid } from 'nanoid';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private email: EmailService,
    private otpService: OtpService,
    private settings: PlatformSettingsService,
  ) {}

  async register(dto: RegisterDto) {
    // Valider le token de vérification téléphone
    const verifiedPhone = await this.otpService.validateToken(dto.phoneVerificationToken);
    if (verifiedPhone !== dto.phone) {
      throw new BadRequestException('Le numéro de téléphone ne correspond pas au code OTP vérifié.');
    }

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
        isVerified: true,
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
        driver: { select: { id: true } },
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

    const isValid = user.passwordHash && await bcrypt.compare(dto.password, user.passwordHash);
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

    const { passwordHash: _, driver, ...userWithoutPassword } = user;
    const driverId = driver?.id;
    const tokens = await this.generateTokens(user.id, user.email, user.role as any, user.tenantId ?? undefined, driverId);
    return { user: { ...userWithoutPassword, driverId }, ...tokens };
  }

  async checkPhoneExists(phone: string): Promise<{ exists: boolean }> {
    const user = await this.prisma.user.findUnique({
      where:  { phone },
      select: { id: true },
    });
    return { exists: !!user };
  }

  async checkEmailExists(email: string): Promise<{ exists: boolean }> {
    const user = await this.prisma.user.findUnique({
      where:  { email },
      select: { id: true },
    });
    return { exists: !!user };
  }

  async loginByPhone(dto: LoginByPhoneDto) {
    await this.otpService.verify(dto.phone, dto.code);

    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      include: {
        driver: { select: { id: true } },
        userStations: {
          where: { station: { isActive: true } },
          include: { station: { select: { id: true, name: true, code: true, isActive: true, city: { select: { name: true } } } } },
          orderBy: { isPrimary: 'desc' },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Impossible de se connecter avec ce numéro');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { passwordHash: _, totpSecret: __, totpBackupCodes: ___, driver, ...userWithoutSecrets } = user;
    const driverId = driver?.id;
    const tokens = await this.generateTokens(
      user.id, user.email, user.role as any,
      user.tenantId ?? undefined,
      driverId,
    );
    return { user: { ...userWithoutSecrets, driverId }, ...tokens };
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
        driver: { select: { id: true } },
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

    const { passwordHash: _, totpSecret: __, totpBackupCodes: ___, driver, ...userWithoutSecrets } = user;
    const driverId = driver?.id;
    const tokens = await this.generateTokens(user.id, user.email, user.role as any, user.tenantId ?? undefined, driverId);
    return { user: { ...userWithoutSecrets, driverId }, ...tokens };
  }

  async generateTotpSetup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.totpEnabled) throw new BadRequestException('Le 2FA est déjà activé');

    const secret = generateSecret();
    const { appName } = await this.settings.getBrand();
    const otpAuthUri = generateURI({ label: user.email, issuer: appName, secret });

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

  private async loadUserPermissions(
    userId: string,
    role: string,
  ): Promise<{ perms: string[]; stationIds: string[] }> {
    if (role === 'SUPER_ADMIN') {
      return { perms: Object.values(PERM), stationIds: [] };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        companyProfile: {
          select: { permissions: { select: { permissionCode: true } } },
        },
        userStations: {
          where: { station: { isActive: true } },
          select: {
            stationId: true,
            stationProfile: {
              select: { permissions: { select: { permissionCode: true } } },
            },
          },
        },
      },
    });

    const stationIds = user?.userStations.map((s) => s.stationId) ?? [];

    let companyPerms = user?.companyProfile?.permissions.map((p) => p.permissionCode) ?? [];

    // Fallback par rôle si aucun profil assigné
    if (companyPerms.length === 0) {
      const roleProfileMap: Record<string, keyof typeof SYSTEM_PROFILES> = {
        [UserRole.COMPANY_OWNER]: 'COMPANY_OWNER',
        [UserRole.COMPANY_ADMIN]: 'COMPANY_ADMIN',
        [UserRole.COMPANY_AGENT]: 'STATION_AGENT',
        [UserRole.DRIVER]: 'DRIVER',
      };
      const defaultProfile = roleProfileMap[role];
      if (defaultProfile) {
        companyPerms = [...(SYSTEM_PROFILES[defaultProfile].permissions as string[])];
      }
      if (role === UserRole.PASSENGER) {
        companyPerms = [PERM.TRIPS_VIEW];
      }
    }

    let stationPerms = user?.userStations.flatMap(
      (s) => s.stationProfile?.permissions.map((p) => p.permissionCode) ?? [],
    ) ?? [];

    if (stationPerms.length === 0 && role === UserRole.COMPANY_AGENT) {
      stationPerms = [...(SYSTEM_PROFILES.STATION_AGENT.permissions as string[])];
    }

    return {
      perms: [...new Set([...companyPerms, ...stationPerms])],
      stationIds,
    };
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
      include: { user: { include: { driver: { select: { id: true } } } } },
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
      stored.user.driver?.id,
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
    const user = await this.prisma.user.findUnique({
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
        totpEnabled: true,
        preferredLang: true,
        avatar: true,
        themeAccent: true,
        themeSidebar: true,
        themeColorMode: true,
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
    if (!user) return null;
    const { perms, stationIds } = await this.loadUserPermissions(userId, user.role);
    return { ...user, perms, stationIds };
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

  async socialLogin(provider: 'google' | 'facebook', idToken: string) {
    let socialId: string;
    let email: string;
    let firstName: string;
    let lastName: string;
    let avatar: string | undefined;

    if (provider === 'google') {
      // Essai 1 : userinfo (access token — flux web et mobile accessToken)
      let data: any = null;
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (userInfoRes.ok) {
        data = await userInfoRes.json();
      } else {
        // Essai 2 : tokeninfo (ID token JWT — flux mobile idToken)
        const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
        if (!tokenInfoRes.ok) throw new UnauthorizedException('Token Google invalide');
        data = await tokenInfoRes.json();
        if (data.error_description) throw new UnauthorizedException('Token Google invalide');
      }
      if (!data?.sub) throw new UnauthorizedException('Token Google invalide');
      socialId  = data.sub;
      email     = data.email;
      firstName = data.given_name  ?? data.name?.split(' ')[0] ?? '';
      lastName  = data.family_name ?? data.name?.split(' ').slice(1).join(' ') ?? '';
      avatar    = data.picture;
    } else {
      const res = await fetch(`https://graph.facebook.com/me?fields=id,email,first_name,last_name,picture.type(large)&access_token=${idToken}`);
      if (!res.ok) throw new UnauthorizedException('Token Facebook invalide');
      const data: any = await res.json();
      if (data.error)  throw new UnauthorizedException('Token Facebook invalide');
      socialId  = data.id;
      email     = data.email ?? `fb_${data.id}@noemail.${this.config.get('APP_DOMAIN', 'transpro.ci')}`;
      firstName = data.first_name ?? '';
      lastName  = data.last_name  ?? '';
      avatar    = data.picture?.data?.url;
    }

    const idField = provider === 'google' ? 'googleId' : 'facebookId';

    let user = await this.prisma.user.findFirst({
      where: { [idField]: socialId },
      include: { driver: { select: { id: true } } },
    });

    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { email },
        include: { driver: { select: { id: true } } },
      });
      if (user) {
        await this.prisma.user.update({ where: { id: user.id }, data: { [idField]: socialId } });
      }
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          [idField]: socialId,
          role: 'PASSENGER' as any,
          isVerified: true,
          avatar,
          lastLoginAt: new Date(),
        },
        include: { driver: { select: { id: true } } },
      });
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), ...(avatar ? { avatar } : {}) },
      });
    }

    if (!user.isActive) throw new UnauthorizedException('Compte désactivé');

    const { passwordHash: _p, totpSecret: _t, totpBackupCodes: _b, driver, ...safe } = user as any;
    const driverId = driver?.id;
    const tokens = await this.generateTokens(user.id, user.email, user.role as any, user.tenantId ?? undefined, driverId);
    return { user: safe, ...tokens };
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: any,
    tenantId?: string,
    driverId?: string,
  ): Promise<AuthTokens> {
    const { perms, stationIds } = await this.loadUserPermissions(userId, role);
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      tenantId,
      perms,
      ...(stationIds.length > 0 ? { stationIds } : {}),
      ...(driverId ? { driverId } : {}),
    };

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
