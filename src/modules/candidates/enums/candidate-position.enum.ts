import { UserRole } from '@/common/enums/user-role.enums';

/**
 * Nomzod qaysi lavozimga da'vogar. `users.role` (rol turi) dan kengroq —
 * HR uchun; ishga olinganda `CANDIDATE_POSITION_BASE_ROLE` bo'yicha mos
 * tizim roli tavsiya qilinadi (forma oldindan tanlaydi, admin o'zgartira oladi).
 */
export enum CandidatePosition {
  TEACHER = 'teacher',
  /** Yordamchi o'qituvchi (assistent) — fan bilan. */
  ASSISTANT = 'assistant',
  /** Administrator (qabulxona). */
  ADMIN = 'admin',
  MANAGER = 'manager',
  /** Sotuv / call-markaz operatori. */
  SALES = 'sales',
  /** Marketolog / SMM. */
  MARKETING = 'marketing',
  /** Buxgalter / kassir. */
  ACCOUNTANT = 'accountant',
  OTHER = 'other',
}

/** Fan faqat shu lavozimlar uchun (o'qituvchi uchun majburiy). */
export const POSITIONS_WITH_SUBJECT: CandidatePosition[] = [
  CandidatePosition.TEACHER,
  CandidatePosition.ASSISTANT,
];

export const CANDIDATE_POSITION_BASE_ROLE: Record<CandidatePosition, UserRole> =
  {
    [CandidatePosition.TEACHER]: UserRole.TEACHER,
    [CandidatePosition.ASSISTANT]: UserRole.OTHER,
    [CandidatePosition.ADMIN]: UserRole.RECEPTION,
    [CandidatePosition.MANAGER]: UserRole.MANAGER,
    [CandidatePosition.SALES]: UserRole.RECEPTION,
    [CandidatePosition.MARKETING]: UserRole.OTHER,
    [CandidatePosition.ACCOUNTANT]: UserRole.OTHER,
    [CandidatePosition.OTHER]: UserRole.OTHER,
  };
