import { AuditAction, AuditModule } from '@/modules/audit-logs/audit-log.enums';

/** Jurnalga yozilmaydigan, lekin sirli bo'lgan kalitlar — qiymati niqoblanadi. */
const SECRET_KEY =
  /pass(word)?|token|secret|authorization|cookie|passport|jshshir|pinfl/i;
const MAX_STRING = 300;
const MAX_ARRAY = 50;
const MAX_DEPTH = 6;
/** Bitta yozuv body'sining eng katta hajmi (JSON belgilarida). */
const MAX_BODY_CHARS = 16_000;
export const HIDDEN = '[hidden]';

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    // Logotip/favicon kabi data URL — mazmuni kerak emas, faqat hajmi.
    if (value.startsWith('data:')) {
      return `[file ${Math.round((value.length * 3) / 4 / 1024)} KB]`;
    }
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((v) => sanitizeValue(v, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY}]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? HIDDEN : sanitizeValue(v, depth + 1);
  }
  return out;
}

/**
 * So'rov ma'lumotini jurnal uchun tozalaydi: sirlar niqoblanadi, uzun
 * satrlar/ro'yxatlar qisqartiriladi, umumiy hajm cheklanadi.
 */
export function sanitizeForAudit(value: unknown): unknown {
  if (value === undefined) return null;
  const clean = sanitizeValue(value, 0);
  const json = JSON.stringify(clean);
  if (json && json.length > MAX_BODY_CHARS) {
    return { truncated: true, preview: json.slice(0, MAX_BODY_CHARS) };
  }
  return clean;
}

export function sanitizeRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return (sanitizeForAudit(value) as Record<string, unknown>) ?? {};
}

export function actionForMethod(method: string): AuditAction {
  if (method === 'DELETE') return AuditAction.DELETE;
  if (method === 'PUT' || method === 'PATCH') return AuditAction.UPDATE;
  return AuditAction.ACTION;
}

/** Route yo'lining birinchi bo'lagi → bo'lim. */
const SEGMENT_MODULE: Record<string, AuditModule> = {
  auth: AuditModule.AUTH,
  users: AuditModule.USERS,
  roles: AuditModule.ROLES,
  students: AuditModule.STUDENTS,
  student: AuditModule.STUDENTS,
  leads: AuditModule.LEADS,
  candidates: AuditModule.CANDIDATES,
  groups: AuditModule.GROUPS,
  group: AuditModule.GROUPS,
  'group-schedule': AuditModule.SCHEDULE,
  attendance: AuditModule.ATTENDANCE,
  holidays: AuditModule.HOLIDAYS,
  payments: AuditModule.PAYMENTS,
  'staff-salaries': AuditModule.PAYROLL,
  staff: AuditModule.PAYROLL,
  'teacher-earnings': AuditModule.PAYROLL,
  expenses: AuditModule.EXPENSES,
  'staff-attendance': AuditModule.STAFF_ATTENDANCE,
  syllabuses: AuditModule.SYLLABUS,
  teachers: AuditModule.SYLLABUS,
  centers: AuditModule.CENTERS,
  rooms: AuditModule.ROOMS,
  subjects: AuditModule.SUBJECTS,
  organizations: AuditModule.ORGANIZATION,
  subscriptions: AuditModule.SUBSCRIPTIONS,
  referrals: AuditModule.REFERRALS,
  telegram: AuditModule.TELEGRAM,
};

/**
 * `/groups/:groupId/attendance/...` davomatga, `/groups/:groupId/plan` —
 * kurs rejasiga tegishli: guruh ichidagi bo'lak birinchi bo'lakdan ustun.
 */
export function resolveAuditModule(path: string): AuditModule {
  const segments = path.split('/').filter((s) => s && !s.startsWith(':'));
  if (segments[0] === 'groups' && segments[1] === 'attendance') {
    return AuditModule.ATTENDANCE;
  }
  if (segments[0] === 'groups' && segments[1] === 'plan') {
    return AuditModule.SYLLABUS;
  }
  return SEGMENT_MODULE[segments[0]] ?? AuditModule.OTHER;
}

/**
 * Hech narsa yozmaydigan POST/PUT so'rovlar (oldindan ko'rish, bandlikni
 * tekshirish) — jurnalni shovqin bilan to'ldirmasligi uchun yozilmaydi.
 * Ro'yxatdan o'tish ham: tashkilot hali yo'q.
 */
export function isReadOnlyMutation(path: string): boolean {
  if (path === '/auth/register') return true;
  if (path === '/group-schedule/conflicts') return true;
  return path
    .split('/')
    .some((s) => !s.startsWith(':') && s.includes('preview'));
}

/** JWT payload'ini (imzosini tekshirmasdan) o'qiydi — login javobi uchun. */
export function decodeJwtPayload(
  token: unknown,
): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
