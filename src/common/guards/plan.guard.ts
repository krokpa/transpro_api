import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantPlan } from '@transpro/shared';

export const PLAN_KEY = 'required_plans';

/** Marks a route as requiring one of the listed plans. */
export const RequiresPlan = (...plans: TenantPlan[]) => SetMetadata(PLAN_KEY, plans);

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TenantPlan[]>(PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No plan restriction → always pass
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();

    // SUPER_ADMIN bypasses plan checks
    if (user?.role === 'SUPER_ADMIN') return true;

    const tenantPlan: TenantPlan | undefined = user?.tenant?.plan;
    if (!tenantPlan || !required.includes(tenantPlan)) {
      throw new ForbiddenException(
        `Cette fonctionnalité requiert un abonnement ${required.join(' ou ')}. Votre plan actuel : ${tenantPlan ?? 'inconnu'}.`,
      );
    }
    return true;
  }
}
