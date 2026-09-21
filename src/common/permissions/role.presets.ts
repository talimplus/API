import { UserRole } from '@/common/enums/user-role.enums';
import { ALL_PERMISSIONS } from './permission.catalog';

/**
 * Tizim (system) rollarining boshlang'ich ruxsat to'plamlari.
 *
 * Bular faqat **seed** uchun: har bir organization ro'yxatdan o'tganda yoki
 * migratsiya paytida shu to'plam bilan rollar yaratiladi. Keyin admin ularni
 * xohlaganicha tahrirlashi mumkin (admin rolidan tashqari — u har doim `*`).
 */
export interface SystemRolePreset {
  key: string;
  name: { uz: string; ru: string };
  baseRole: UserRole;
  permissions: string[];
  /** `true` — o'chirib/tahrirlab bo'lmaydi (faqat admin roli uchun) */
  locked: boolean;
}

const MANAGER_PERMISSIONS = [
  'students.view',
  'students.create',
  'students.update',
  'students.changeStatus',
  'students.discounts',
  'students.transfer',
  'leads.view',
  'leads.create',
  'leads.update',
  'leads.delete',
  'leads.transfer',
  'groups.view',
  'groups.create',
  'groups.update',
  'groups.changeStatus',
  'attendance.view',
  'attendance.manage',
  'schedule.view',
  'schedule.manage',
  'syllabus.view',
  'syllabus.manage',
  'syllabus.ai',
  'groupPlan.view',
  'groupPlan.manage',
  'groupPlan.attach',
  'payments.view',
  'payments.create',
  'payments.update',
  'payments.export',
  'payments.recalculate',
  'payments.exclusion',
  'centers.view',
  'rooms.view',
  'rooms.manage',
  'subjects.view',
  'subjects.manage',
  'staffAttendance.checkIn',
  'staffAttendance.viewOwn',
  'staffAttendance.view',
  'staffAttendance.manage',
  'staffPerformance.view',
];

const RECEPTION_PERMISSIONS = [
  'students.view',
  'students.create',
  'students.update',
  'students.changeStatus',
  'students.transfer',
  'leads.view',
  'leads.create',
  'leads.update',
  'leads.delete',
  'leads.transfer',
  'groups.view',
  'groups.create',
  'groups.update',
  'groups.changeStatus',
  'attendance.view',
  'attendance.manage',
  'attendance.managePast',
  'schedule.view',
  'payments.view',
  'payments.create',
  'payments.export',
  'payments.recalculate',
  'payments.exclusion',
  'rooms.view',
  'subjects.view',
  'staffAttendance.checkIn',
  'staffAttendance.viewOwn',
  'staffAttendance.view',
  'staffAttendance.manage',
];

const TEACHER_PERMISSIONS = [
  'teacher.today',
  'groups.view',
  'students.view',
  'attendance.view',
  'attendance.manage',
  'attendance.managePast',
  'schedule.view',
  'syllabus.view',
  'groupPlan.view',
  'groupPlan.manage',
  'staffAttendance.checkIn',
  'staffAttendance.viewOwn',
];

export const SYSTEM_ROLE_PRESETS: SystemRolePreset[] = [
  {
    key: 'admin',
    name: { uz: 'Administrator', ru: 'Администратор' },
    baseRole: UserRole.ADMIN,
    permissions: [ALL_PERMISSIONS],
    locked: true,
  },
  {
    key: 'manager',
    name: { uz: 'Menejer', ru: 'Менеджер' },
    baseRole: UserRole.MANAGER,
    permissions: MANAGER_PERMISSIONS,
    locked: false,
  },
  {
    key: 'reception',
    name: { uz: 'Qabulxona', ru: 'Ресепшн' },
    baseRole: UserRole.RECEPTION,
    permissions: RECEPTION_PERMISSIONS,
    locked: false,
  },
  {
    key: 'teacher',
    name: { uz: 'O‘qituvchi', ru: 'Преподаватель' },
    baseRole: UserRole.TEACHER,
    permissions: TEACHER_PERMISSIONS,
    locked: false,
  },
  {
    key: 'other',
    name: { uz: 'Boshqa', ru: 'Другое' },
    baseRole: UserRole.OTHER,
    permissions: [
      'groups.view',
      'staffAttendance.checkIn',
      'staffAttendance.viewOwn',
    ],
    locked: false,
  },
];

/** `super_admin` — platforma darajasidagi rol, organization ichida seed qilinmaydi. */
export const getPresetByBaseRole = (
  baseRole: UserRole,
): SystemRolePreset | undefined =>
  SYSTEM_ROLE_PRESETS.find((p) => p.baseRole === baseRole);
