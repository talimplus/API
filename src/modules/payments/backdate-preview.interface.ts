import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { EnrollmentWindow } from '@/modules/enrollments/enrollments.service';

/**
 * Orqaga sanalash preview'i uchun bitta (o'quvchi, guruh) simulyatsiyasi.
 * `student`/`group` — o'zgartirilgan NUSXALAR (activatedAt, startDate),
 * `windows` — taxminiy a'zolik oynalari (`undefined` — DB'dagisi).
 */
export interface BackdateSimulation {
  student: Student;
  group: Group;
  windows?: EnrollmentWindow[];
  fromMonth: string; // YYYY-MM-01
  /** Oxirgi taqqoslanadigan oy — qo'llash ham shu oygacha. Default — joriy oy. */
  toMonth?: string; // YYYY-MM-01
}

/** Bitta to'lov qatori qanday o'zgarishi (faqat o'zgaradiganlari qaytadi). */
export interface BackdatePreviewRow {
  studentId: number;
  studentName: string;
  groupId: number;
  groupName: string;
  forMonth: string; // YYYY-MM-01
  /** Qator hozir yo'q — yangi yaratiladi. */
  isNew: boolean;
  currentDue: number;
  newDue: number;
  amountPaid: number;
  /** To'langan puldan ortiqcha qismi — `refundedAmount` ga tushadi. */
  refund: number;
}

export interface BackdatePaidSalaryMonth {
  teacherId: number;
  teacherName: string;
  forMonth: string; // YYYY-MM-01
}

export interface BackdatePreview {
  rows: BackdatePreviewRow[];
  totals: {
    /** Qo'shiladigan qarz (yangi qatorlar + oshgan summalar). */
    debtIncrease: number;
    /** Kamayadigan qarz (to'lanmagan qismdan). */
    debtDecrease: number;
    /** Qaytariladigan pul (to'langan, endi ortiqcha). */
    refund: number;
  };
  /**
   * Oyligi berilgan (muzlagan) o'qituvchi oylari. Bu oylarga keyin tushgan
   * pulning ulushi keyingi to'lanmagan oylikka carryover bo'lib o'tadi.
   */
  paidSalaryMonths: BackdatePaidSalaryMonth[];
}
