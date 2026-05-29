import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from '@transpro/shared';

export const PERMISSIONS_KEY = 'required_permissions';

export const RequirePermission = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
