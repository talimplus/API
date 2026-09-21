import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Endpoint uchun kerakli ruxsat(lar).
 *
 * Bir nechta kalit berilsa — **bittasi yetarli** (OR):
 * `@RequirePermissions('payments.view', 'receipts.view')`.
 *
 * Kalitlar `@/common/permissions/permission.catalog.ts` dagi katalogdan olinadi.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
