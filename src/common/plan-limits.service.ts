import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPlan, PLAN_LIMITS, getPlanLimits } from '@transpro/shared';

export type LimitResource = 'users' | 'stations' | 'vehicles' | 'drivers' | 'routes';

@Injectable()
export class PlanLimitsService {
  constructor(private prisma: PrismaService) {}

  /** Vérifie qu'un tenant n'a pas atteint la limite du plan pour une ressource.
   *  Lève ForbiddenException si la limite est dépassée. */
  async assertLimit(tenantId: string, resource: LimitResource): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });

    if (!tenant) return; // sécurité — le tenant guard a déjà vérifié

    const limits = getPlanLimits(tenant.plan as TenantPlan);

    let current = 0;
    switch (resource) {
      case 'users':
        current = await this.prisma.user.count({
          where: { tenantId, isActive: true, role: { not: 'PASSENGER' } },
        });
        if (current >= limits.maxUsers) {
          throw new ForbiddenException(
            `Limite atteinte : votre plan ${tenant.plan} autorise au maximum ${limits.maxUsers} utilisateur(s) staff. Passez au plan supérieur pour en ajouter.`,
          );
        }
        break;

      case 'stations':
        current = await this.prisma.station.count({ where: { tenantId } });
        if (current >= limits.maxStations) {
          throw new ForbiddenException(
            `Limite atteinte : votre plan ${tenant.plan} autorise au maximum ${limits.maxStations} gare(s). Passez au plan supérieur pour en ajouter.`,
          );
        }
        break;

      case 'vehicles':
        current = await this.prisma.vehicle.count({ where: { tenantId } });
        if (current >= limits.maxVehicles) {
          throw new ForbiddenException(
            `Limite atteinte : votre plan ${tenant.plan} autorise au maximum ${limits.maxVehicles} véhicule(s).`,
          );
        }
        break;

      case 'drivers':
        current = await this.prisma.driver.count({ where: { tenantId } });
        if (current >= limits.maxDrivers) {
          throw new ForbiddenException(
            `Limite atteinte : votre plan ${tenant.plan} autorise au maximum ${limits.maxDrivers} chauffeur(s).`,
          );
        }
        break;

      case 'routes':
        current = await this.prisma.route.count({ where: { tenantId } });
        if (current >= limits.maxRoutes) {
          throw new ForbiddenException(
            `Limite atteinte : votre plan ${tenant.plan} autorise au maximum ${limits.maxRoutes} itinéraire(s).`,
          );
        }
        break;
    }
  }

  /** Retourne un résumé de l'utilisation des ressources d'un tenant. */
  async getUsage(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });

    const limits = getPlanLimits((tenant?.plan ?? 'BASIC') as TenantPlan);

    const [users, stations, vehicles, drivers, routes] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, isActive: true, role: { not: 'PASSENGER' } } }),
      this.prisma.station.count({ where: { tenantId } }),
      this.prisma.vehicle.count({ where: { tenantId } }),
      this.prisma.driver.count({ where: { tenantId } }),
      this.prisma.route.count({ where: { tenantId } }),
    ]);

    return {
      plan: tenant?.plan,
      limits,
      usage: { users, stations, vehicles, drivers, routes },
    };
  }
}
