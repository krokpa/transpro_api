import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload, PERM, UserRole, SYSTEM_PROFILES } from '@transpro/shared';

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
      // Permissions du profil compagnie explicitement assigné
      let companyPerms = user.companyProfile?.permissions.map((p) => p.permissionCode) ?? [];

      // Fallback : si aucun profil assigné, utiliser les permissions par défaut du rôle
      // (pour les utilisateurs créés avant le système RBAC ou sans profil explicite)
      if (companyPerms.length === 0) {
        const roleProfileMap: Record<string, keyof typeof SYSTEM_PROFILES> = {
          [UserRole.COMPANY_OWNER]: 'COMPANY_OWNER',
          [UserRole.COMPANY_ADMIN]: 'COMPANY_ADMIN',
          [UserRole.COMPANY_AGENT]: 'STATION_AGENT',
        };
        const defaultProfile = roleProfileMap[user.role as string];
        if (defaultProfile) {
          companyPerms = [...(SYSTEM_PROFILES[defaultProfile].permissions as string[])];
        }
        // Les passagers peuvent voir les voyages (détails, sièges) et leurs propres données
        if (user.role === UserRole.PASSENGER) {
          companyPerms = [PERM.TRIPS_VIEW];
        }
      }

      // Permissions du profil de la gare primaire (ou fallback par rôle si non assigné)
      const primaryStation = user.userStations.find((s) => s.isPrimary) ?? user.userStations[0];
      let stationPerms = primaryStation?.stationProfile?.permissions.map((p) => p.permissionCode) ?? [];

      if (stationPerms.length === 0 && user.role === UserRole.COMPANY_AGENT) {
        stationPerms = [...(SYSTEM_PROFILES.STATION_AGENT.permissions as string[])];
      }

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
