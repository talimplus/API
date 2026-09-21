import { UserRole } from '@/common/enums/user-role.enums';

export interface CurrentUser {
  userId: number;
  email: string;
  /** Rol turi (biznes-mantiq uchun). Ruxsatlar `roleId` dagi roldan o'qiladi. */
  role: UserRole;
  /** Dinamik rol id'si (`users.userRole`). Eski userlarda `null` bo'lishi mumkin. */
  roleId?: number | null;
  centerId?: number;
  organizationId: number;
}
