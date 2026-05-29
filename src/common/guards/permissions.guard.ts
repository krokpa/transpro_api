import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionCode, UserRole } from '@transpro/shared';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionCode[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();

    // SUPER_ADMIN bypass total
    if (user?.role === UserRole.SUPER_ADMIN) return true;

    const userPerms: string[] = user?.perms ?? [];
    const hasAll = required.every((p) => userPerms.includes(p));

    if (!hasAll) {
      const missing = required.filter((p) => !userPerms.includes(p));
      throw new ForbiddenException(
        `Permission(s) manquante(s) : ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
