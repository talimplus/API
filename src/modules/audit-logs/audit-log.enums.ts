/**
 * Jurnaldagi amal turi — HTTP metodidan chiqadi (login/logout alohida).
 * Front shu qiymatlarga qarab belgi chiqaradi — o'zgarsa front enum ham.
 */
export enum AuditAction {
  /** POST — yaratish yoki biror amal (to'lov qabul qilish, ko'chirish ...) */
  ACTION = 'action',
  /** PUT / PATCH */
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  LOGOUT = 'logout',
}

/**
 * Jurnal bo'limlari (filtr uchun). Controller yo'lidan chiqariladi
 * (`resolveAuditModule`). Front enum bilan bir xil bo'lishi shart.
 */
export enum AuditModule {
  AUTH = 'auth',
  USERS = 'users',
  ROLES = 'roles',
  STUDENTS = 'students',
  LEADS = 'leads',
  CANDIDATES = 'candidates',
  GROUPS = 'groups',
  SCHEDULE = 'schedule',
  ATTENDANCE = 'attendance',
  HOLIDAYS = 'holidays',
  PAYMENTS = 'payments',
  PAYROLL = 'payroll',
  EXPENSES = 'expenses',
  STAFF_ATTENDANCE = 'staffAttendance',
  SYLLABUS = 'syllabus',
  CENTERS = 'centers',
  ROOMS = 'rooms',
  SUBJECTS = 'subjects',
  ORGANIZATION = 'organization',
  SUBSCRIPTIONS = 'subscriptions',
  REFERRALS = 'referrals',
  TELEGRAM = 'telegram',
  OTHER = 'other',
}
