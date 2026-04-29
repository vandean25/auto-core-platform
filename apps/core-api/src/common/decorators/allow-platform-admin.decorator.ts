import { SetMetadata } from '@nestjs/common';

export const ALLOW_PLATFORM_ADMIN_KEY = 'allowPlatformAdmin';

export const AllowPlatformAdmin = () =>
  SetMetadata(ALLOW_PLATFORM_ADMIN_KEY, true);
