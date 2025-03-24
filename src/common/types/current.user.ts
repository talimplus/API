import { UserRole } from '@/common/enums/user-role.enums';

export interface CurrentUser {
  userId: number;
  email: string;
  role: UserRole;
  centerId: number;
  organizationId: number;
}
