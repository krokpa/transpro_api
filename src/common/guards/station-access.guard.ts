import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@transpro/shared';

/**
 * Vérifie que l'utilisateur est bien affecté à la gare demandée (:id param).
 * Bypass automatique pour SUPER_ADMIN, COMPANY_OWNER et COMPANY_ADMIN.
 * À appliquer sur les routes workspace-gare pour limiter les agents à leurs gares.
 */
@Injectable()
export class StationAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const stationId: string | undefined = request.params?.id;

    if (!stationId) return true;
    if (!user) return false;

    if (
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.COMPANY_OWNER ||
      user.role === UserRole.COMPANY_ADMIN
    ) {
      return true;
    }

    const assigned: string[] = user.stationIds ?? [];
    if (!assigned.includes(stationId)) {
      throw new ForbiddenException('Accès refusé : vous n\'êtes pas affecté à cette gare');
    }

    return true;
  }
}
