import { SetMetadata } from '@nestjs/common';
import { ApiScope } from '@transpro/shared';

export const SCOPES_KEY = 'api_scopes';
export const RequireScope = (...scopes: ApiScope[]) => SetMetadata(SCOPES_KEY, scopes);
