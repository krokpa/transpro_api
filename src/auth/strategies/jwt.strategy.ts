import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload, PERM, UserRole } from '@transpro/shared';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        isActive: true,
        companyProfileId: true,
        tenant: { select: { plan: true, status: true } },
        companyProfile: {
          select: {
            permissions: { select: { permissionCode: true } },
          },
        },
        userStations: {
          where: { station: { isActive: true } },
          select: {
            stationId: true,
            isPrimary: true,
            stationProfileId: true,
            stationProfile: {
              select: {
                permissions: { select: { permissionCode: true } },
              },
            },
          },
          orderBy: { isPrimary: 'desc' },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Compte désactivé ou introuvable');
    }

    // SUPER_ADMIN a toutes les permissions sans profil
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    let perms: string[] = isSuperAdmin ? Object.values(PERM) : [];

    if (!isSuperAdmin) {
      // Permissions du profil compagnie
      const companyPerms = user.companyProfile?.permissions.map((p) => p.permissionCode) ?? [];

      // Permissions du profil de la gare primaire
      const primaryStation = user.userStations.find((s) => s.isPrimary) ?? user.userStations[0];
      const stationPerms = primaryStation?.stationProfile?.permissions.map((p) => p.permissionCode) ?? [];

      // Union sans doublons
      perms = [...new Set([...companyPerms, ...stationPerms])];
    }

    const { userStations, companyProfile, ...rest } = user;
    return {
      ...rest,
      stationId: userStations.find((s) => s.isPrimary)?.stationId ?? userStations[0]?.stationId ?? null,
      // Toutes les gares de l'utilisateur avec leurs profils (pour verifyAccess)
      stationIds: userStations.map((s) => s.stationId),
      perms,
    };
  }
}
