import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudentGroupFee } from '@/modules/students/entities/student-group-fee.entity';
import { DEFAULT_TIMEZONE } from '@/modules/groups/group-fee.service';
import { dayjs } from '@/shared/utils/dayjs';

/** Bitta guruhdagi shaxsiy narx qatori. */
export interface GroupFeePeriod {
  groupId: number;
  fromMonth: string; // YYYY-MM-01
  monthlyFee: number;
}

/** Guruh uchun hozirgi va rejalashtirilgan shaxsiy narx (forma/kartochka). */
export interface GroupFeeState {
  groupId: number;
  /** Joriy oyda amaldagi shaxsiy narx (0 — guruh narxi). */
  monthlyFee: number;
  /** Keyingi oydan kuchga kiradigan narx (pul olingan oyda o'zgartirilgan). */
  upcomingMonthlyFee: number | null;
  upcomingFromMonth: string | null;
}

/**
 * Oy uchun amaldagi qator: `fromMonth <= forMonth` ga mos eng oxirgisi,
 * bo'lmasa eng birinchisi. Qator yo'q — `null` (guruh narxi).
 */
export function pickGroupFeeForMonth(
  periods: GroupFeePeriod[],
  forMonth: string,
): GroupFeePeriod | null {
  if (!periods?.length) return null;
  const sorted = [...periods].sort((a, b) =>
    a.fromMonth.localeCompare(b.fromMonth),
  );
  let picked: GroupFeePeriod | null = null;
  for (const p of sorted) {
    if (p.fromMonth <= forMonth) picked = p;
    else break;
  }
  return picked ?? sorted[0];
}

/**
 * O'quvchining HAR BIR GURUHDAGI shaxsiy narxi (2026-11-20).
 *
 * Ilgari bitta narx barcha guruhlarga qo'llanardi. Endi har bir guruhda
 * alohida; qoida doimiy chegirma bilan bir xil: o'zgartirilsa, shu oy uchun
 * SHU GURUHDA pul olinmagan bo'lsa — shu oydan, olingan bo'lsa — keyingi oydan.
 * O'tgan oylar qayta narxlanmaydi. Adashib yozilgan narxni o'tgan oydan olib
 * tashlash — `clearFrom` (`StudentPersonalFeeService`).
 */
@Injectable()
export class StudentGroupFeeService {
  constructor(
    @InjectRepository(StudentGroupFee)
    private readonly repo: Repository<StudentGroupFee>,
  ) {}

  currentMonth(): string {
    return dayjs().tz(DEFAULT_TIMEZONE).startOf('month').format('YYYY-MM-01');
  }

  /** O'quvchining barcha guruhlardagi narx tarixi (`groupId` bo'yicha). */
  async getPeriods(studentId: number): Promise<Map<number, GroupFeePeriod[]>> {
    const rows: any[] = await this.repo.query(
      `SELECT "groupId", TO_CHAR("fromMonth", 'YYYY-MM-01') AS "fromMonth", "monthlyFee"
         FROM "student_group_fees"
        WHERE "studentId" = $1
        ORDER BY "groupId", "fromMonth"`,
      [studentId],
    );
    const map = new Map<number, GroupFeePeriod[]>();
    for (const r of rows ?? []) {
      const groupId = Number(r.groupId);
      const list = map.get(groupId) ?? [];
      list.push({
        groupId,
        fromMonth: r.fromMonth,
        monthlyFee: Number(r.monthlyFee ?? 0),
      });
      map.set(groupId, list);
    }
    return map;
  }

  async feeForMonth(studentId: number, groupId: number, forMonth: string) {
    const periods = (await this.getPeriods(studentId)).get(groupId) ?? [];
    return Number(pickGroupFeeForMonth(periods, forMonth)?.monthlyFee ?? 0);
  }

  /** Guruhlar bo'yicha joriy oy narxi va rejalashtirilgan o'zgarish. */
  async states(
    studentId: number,
    groupIds: number[],
  ): Promise<GroupFeeState[]> {
    const current = this.currentMonth();
    const all = await this.getPeriods(studentId);
    return groupIds.map((groupId) => {
      const periods = all.get(groupId) ?? [];
      const now = pickGroupFeeForMonth(periods, current);
      const next = periods.find((p) => p.fromMonth > current) ?? null;
      return {
        groupId,
        monthlyFee: Number(now?.monthlyFee ?? 0),
        upcomingMonthlyFee: next ? next.monthlyFee : null,
        upcomingFromMonth: next ? next.fromMonth : null,
      };
    });
  }

  /** Shu oy uchun shu guruhda o'quvchidan pul olinganmi (pending chek ham). */
  async hasMoneyForMonth(
    studentId: number,
    groupId: number,
    forMonth: string,
  ): Promise<boolean> {
    const rows = await this.repo.query(
      `SELECT 1 FROM "payments" p
        WHERE p."studentId" = $1 AND p."groupId" = $2 AND p."forMonth" = $3::date
          AND (p."amountPaid" > 0 OR EXISTS (
                SELECT 1 FROM "payment_receipts" r
                 WHERE r."paymentId" = p."id" AND r."status" = 'pending'))
        LIMIT 1`,
      [studentId, groupId, forMonth],
    );
    return (rows ?? []).length > 0;
  }

  /**
   * Guruhdagi shaxsiy narxni o'zgartiradi (0 — guruh narxi).
   * @returns kuchga kiradigan oy (o'zgarish bo'lmasa null)
   */
  async setFee(
    studentId: number,
    groupId: number,
    fee: number,
  ): Promise<{ effectiveFrom: string | null }> {
    const next = Math.max(0, Number(fee ?? 0));
    const current = this.currentMonth();
    const periods = (await this.getPeriods(studentId)).get(groupId) ?? [];
    const now = Number(pickGroupFeeForMonth(periods, current)?.monthlyFee ?? 0);

    if (now === next) {
      // Qiymat aslida o'zgarmayapti — rejalashtirilgan o'zgarish bekor.
      await this.deleteAfter(studentId, groupId, current);
      return { effectiveFrom: null };
    }

    const from = (await this.hasMoneyForMonth(studentId, groupId, current))
      ? dayjs(current).add(1, 'month').format('YYYY-MM-01')
      : current;

    // `from` dan oldingi oylar eski narxda qolsin ("eng birinchi qator"
    // qoidasi ularni yangi narxga tortmasin).
    if (!periods.some((p) => p.fromMonth < from)) {
      await this.upsert(studentId, groupId, prevMonth(from), now);
    }
    await this.deleteAfter(studentId, groupId, current);
    await this.upsert(studentId, groupId, from, next);
    return { effectiveFrom: from };
  }

  /**
   * Adashib yozilgan narxni `fromMonth` dan olib tashlaydi (o'tgan oy ham
   * bo'lishi mumkin). Oldingi oylar eski narxda qoladi; qayta hisoblashni
   * chaqiruvchi qiladi.
   */
  async clearFrom(
    studentId: number,
    groupId: number,
    fromMonth: string,
  ): Promise<void> {
    const periods = (await this.getPeriods(studentId)).get(groupId) ?? [];
    if (!periods.some((p) => p.fromMonth < fromMonth)) {
      const first = periods[0];
      await this.upsert(
        studentId,
        groupId,
        prevMonth(fromMonth),
        Number(first?.monthlyFee ?? 0),
      );
    }
    await this.upsert(studentId, groupId, fromMonth, 0);
    await this.repo.query(
      `UPDATE "student_group_fees" SET "monthlyFee" = 0
        WHERE "studentId" = $1 AND "groupId" = $2 AND "fromMonth" > $3::date`,
      [studentId, groupId, fromMonth],
    );
  }

  /**
   * `fromMonth` dan keyin shu guruhda shaxsiy narx (> 0) amal qiladimi.
   */
  async hasFeeFrom(studentId: number, groupId: number, fromMonth: string) {
    const periods = (await this.getPeriods(studentId)).get(groupId) ?? [];
    const atStart = pickGroupFeeForMonth(periods, fromMonth);
    return (
      Number(atStart?.monthlyFee ?? 0) > 0 ||
      periods.some((p) => p.fromMonth > fromMonth && p.monthlyFee > 0)
    );
  }

  /**
   * Eski front uchun `students.monthlyFee` nusxasi: hozirgi guruhlarning
   * hammasida bir xil shaxsiy narx bo'lsa — o'sha, aks holda 0.
   */
  async legacyFee(studentId: number, groupIds: number[]): Promise<number> {
    if (!groupIds.length) return 0;
    const states = await this.states(studentId, groupIds);
    const fees = new Set(states.map((s) => s.monthlyFee));
    if (fees.size !== 1) return 0;
    return Math.max(0, [...fees][0]);
  }

  private async upsert(
    studentId: number,
    groupId: number,
    fromMonth: string,
    monthlyFee: number,
  ) {
    await this.repo.query(
      `INSERT INTO "student_group_fees" ("studentId", "groupId", "fromMonth", "monthlyFee")
       VALUES ($1, $2, $3::date, $4)
       ON CONFLICT ("studentId", "groupId", "fromMonth")
       DO UPDATE SET "monthlyFee" = EXCLUDED."monthlyFee"`,
      [studentId, groupId, fromMonth, monthlyFee],
    );
  }

  private async deleteAfter(studentId: number, groupId: number, month: string) {
    await this.repo.query(
      `DELETE FROM "student_group_fees"
        WHERE "studentId" = $1 AND "groupId" = $2 AND "fromMonth" > $3::date`,
      [studentId, groupId, month],
    );
  }
}

function prevMonth(month: string): string {
  return dayjs(month).subtract(1, 'month').format('YYYY-MM-01');
}
