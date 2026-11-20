import { ForbiddenException } from '@nestjs/common';
import { RolesService } from '@/modules/roles/roles.service';
import { CurrentUser } from '@/common/types/current.user';

/** O'quvchi/lid shaxsiy oylik narxini yozish ruxsati (default faqat admin). */
export const PERSONAL_FEE_PERMISSION = 'students.personalFee';

/**
 * Shaxsiy narx (`monthlyFee`) faqat ruxsati borga o'zgaradi. Yuborilmagan yoki
 * hozirgisiga teng qiymat (eski front formani to'liq yuboradi) — o'tkaziladi.
 */
export async function assertCanSetPersonalFee(
  roles: RolesService,
  user: CurrentUser,
  next: number | null | undefined,
  current: number | null | undefined = 0,
): Promise<void> {
  if (next === undefined) return;
  if (Number(next ?? 0) === Number(current ?? 0)) return;
  if (await roles.userHasPermission(user, [PERSONAL_FEE_PERMISSION])) return;
  throw new ForbiddenException(
    'O‘quvchiga shaxsiy narx belgilashga ruxsatingiz yo‘q — guruh narxi ishlatiladi',
  );
}
