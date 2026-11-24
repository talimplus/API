import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudentBaseDiscount } from '@/modules/students/entities/student-base-discount.entity';
import { DEFAULT_TIMEZONE } from '@/modules/groups/group-fee.service';
import { dayjs } from '@/shared/utils/dayjs';

/** Oyga bog'langan doimiy chegirma qatori. */
export interface BaseDiscountPeriod {
  /** NULL — barcha guruhlarga. */
  groupId: number | null;
  fromMonth: string; // YYYY-MM-01
  percent: number;
  amount: number;
  reason: string | null;
  /**
   * ESKI: shaxsiy narx (2026-11-20 gacha). Endi to'lov undan o'qilmaydi —
   * `student_group_fees` (guruh bo'yicha). Faqat tarix (timeline) uchun.
   */
  monthlyFee: number | null;
}

/** Bitta doira (guruh yoki barcha guruhlar) uchun oxirgi kiritilgan chegirma. */
export interface BaseDiscountState {
  groupId: number | null;
  percent: number;
  amount: number;
  reason: string | null;
  /** Kuchga kirgan (yoki kiradigan) oy, YYYY-MM-01; tarix bo'lmasa null. */
  fromMonth: string | null;
}

export interface BaseDiscountValue {
  percent: number;
  amount: number;
  reason: string | null;
}

/**
 * Bitta oy uchun amaldagi doimiy chegirmani tanlaydi.
 *
 * - `fromMonth <= forMonth` bo'lgan eng oxirgi qator;
 * - bunday qator bo'lmasa — eng birinchi qator;
 * - umuman qator bo'lmasa — `null` (chaqiruvchi `students` ustunlariga qaytadi).
 */
export function pickBaseDiscountForMonth(
  periods: BaseDiscountPeriod[],
  forMonth: string,
): BaseDiscountPeriod | null {
  if (!periods?.length) return null;
  const sorted = [...periods].sort((a, b) =>
    a.fromMonth < b.fromMonth ? -1 : a.fromMonth > b.fromMonth ? 1 : 0,
  );
  let picked: BaseDiscountPeriod | null = null;
  for (const p of sorted) {
    if (p.fromMonth <= forMonth) picked = p;
    else break;
  }
  return picked ?? sorted[0];
}

/**
 * O'quvchining doimiy chegirmasini oy aniqligida boshqaradi (shaxsiy narx —
 * `StudentGroupFeeService`, guruh bo'yicha).
 *
 * BIZNES QOIDA: chegirma o'zgartirilganda —
 * - o'quvchi shu oy uchun hali pul bermagan bo'lsa → **shu oydan** kuchga kiradi;
 * - shu oy uchun pul berilgan bo'lsa (qisman, to'liq yoki tasdiqlanmagan chek)
 *   → **keyingi oydan**.
 * O'tgan oylar hech qachon qayta narxlanmaydi.
 */
@Injectable()
export class StudentBaseDiscountService {
  constructor(
    @InjectRepository(StudentBaseDiscount)
    private readonly repo: Repository<StudentBaseDiscount>,
  ) {}

  currentMonth(): string {
    return dayjs().tz(DEFAULT_TIMEZONE).startOf('month').format('YYYY-MM-01');
  }

  async getPeriods(studentId: number): Promise<BaseDiscountPeriod[]> {
    const rows = await this.repo.query(
      `SELECT TO_CHAR("fromMonth", 'YYYY-MM-01') AS "fromMonth",
              "groupId", "percent", "amount", "reason", "monthlyFee"
         FROM "student_base_discounts"
        WHERE "studentId" = $1
        ORDER BY "fromMonth" ASC`,
      [studentId],
    );
    return (rows ?? []).map((r: any) => ({
      groupId: r.groupId == null ? null : Number(r.groupId),
      fromMonth: r.fromMonth,
      percent: Number(r.percent ?? 0),
      amount: Number(r.amount ?? 0),
      reason: r.reason ?? null,
      monthlyFee: r.monthlyFee == null ? null : Number(r.monthlyFee),
    }));
  }

  /** Shu oy uchun o'quvchidan pul olinganmi (tasdiqlanmagan chek ham hisob). */
  async hasMoneyForMonth(
    studentId: number,
    forMonth: string,
    groupId: number | null = null,
  ): Promise<boolean> {
    const rows = await this.repo.query(
      `SELECT 1
         FROM "payments" p
        WHERE p."studentId" = $1
          AND p."forMonth" = $2::date
          AND ($3::int IS NULL OR p."groupId" = $3)
          AND (
            p."amountPaid" > 0
            OR EXISTS (
              SELECT 1 FROM "payment_receipts" r
               WHERE r."paymentId" = p."id" AND r."status" = 'pending'
            )
          )
        LIMIT 1`,
      [studentId, forMonth, groupId],
    );
    return (rows ?? []).length > 0;
  }

  /**
   * Doimiy chegirmani o'zgartiradi.
   *
   * @param previous — o'zgarishdan oldingi `students` ustunlari (tarix hali
   *                   bo'lmasa, o'tgan oylar shu qiymatda qolishi uchun).
   * @returns `effectiveFrom` — chegirma kuchga kiradigan oy (o'zgarish
   *          bo'lmasa null).
   */
  async setDiscount(
    studentId: number,
    previous: BaseDiscountValue,
    next: BaseDiscountValue,
    groupId: number | null = null,
  ): Promise<{ effectiveFrom: string | null }> {
    const current = this.currentMonth();
    const periods = (await this.getPeriods(studentId)).filter(
      (p) => p.groupId === groupId,
    );
    // Forma har saqlashda qayta yuboradi: oxirgi (rejadagi ham) qiymat bilan
    // bir xil bo'lsa — hech narsa o'zgarmaydi.
    const latest = periods[periods.length - 1];
    if (
      latest &&
      latest.percent === next.percent &&
      latest.amount === next.amount
    ) {
      return { effectiveFrom: null };
    }
    const inEffect = pickBaseDiscountForMonth(periods, current) ?? {
      fromMonth: current,
      ...previous,
    };
    const sameAsNow =
      inEffect.percent === next.percent && inEffect.amount === next.amount;
    if (sameAsNow) {
      // Qiymat aslida o'zgarmayapti — rejalashtirilgan kelgusi o'zgarish
      // bo'lsa bekor qilinadi (admin fikridan qaytdi).
      await this.clearFuturePeriods(studentId, groupId, current);
      return { effectiveFrom: null };
    }

    const from = (await this.hasMoneyForMonth(studentId, current, groupId))
      ? dayjs(current).add(1, 'month').format('YYYY-MM-01')
      : current;

    if (!periods.some((p) => p.fromMonth < from)) {
      // `from` dan oldingi qator yo'q: eski qiymatni tarixga yozamiz, shunda
      // oldingi oylar (orqaga sanalganlari ham) eski chegirmada qoladi.
      const { percent, amount, reason } = periods[0] ?? previous;
      await this.upsertPeriod(studentId, {
        groupId,
        fromMonth: dayjs(from).subtract(1, 'month').format('YYYY-MM-01'),
        percent,
        amount,
        reason,
      });
    }

    await this.clearFuturePeriods(studentId, groupId, current);
    await this.upsertPeriod(studentId, { groupId, fromMonth: from, ...next });
    return { effectiveFrom: from };
  }

  /**
   * Yangi o'quvchi: guruhga bog'langan chegirma joriy oydan yoziladi (undan
   * oldingi oylar ham "eng birinchi qator" qoidasi bilan shu qiymatda).
   */
  async initGroupDiscount(
    studentId: number,
    groupId: number,
    value: BaseDiscountValue,
  ) {
    await this.upsertPeriod(studentId, {
      groupId,
      fromMonth: this.currentMonth(),
      ...value,
    });
  }

  /**
   * Barcha doimiy chegirmalarni SHU OYDAN olib tashlaydi (pul olingan bo'lsa
   * ham — admin tasdiqlagan). Oldingi oylar eski chegirmada qoladi.
   */
  async clearFromCurrentMonth(studentId: number, previous: BaseDiscountValue) {
    const current = this.currentMonth();
    const periods = await this.getPeriods(studentId);
    const scopes = new Set<number | null>(periods.map((p) => p.groupId));
    scopes.add(null);
    for (const groupId of scopes) {
      const own = periods.filter((p) => p.groupId === groupId);
      // Hech qachon chegirma bo'lmagan doira — yozadigan narsa yo'q.
      if (!own.length && !previous.percent && !previous.amount) continue;
      if (!own.some((p) => p.fromMonth < current)) {
        // Oldingi oylar (orqaga sanalganlari ham) eski qiymatda qolsin.
        const { percent, amount, reason } = own[0] ?? previous;
        await this.upsertPeriod(studentId, {
          groupId,
          fromMonth: dayjs(current).subtract(1, 'month').format('YYYY-MM-01'),
          percent,
          amount,
          reason,
        });
      }
      await this.clearFuturePeriods(studentId, groupId, current);
      await this.upsertPeriod(studentId, {
        groupId,
        fromMonth: current,
        percent: 0,
        amount: 0,
        reason: null,
      });
    }
  }

  /**
   * Har bir o'quvchining amaldagi/rejadagi doimiy chegirmalari (oxirgi
   * kiritilgan qiymat, nol bo'lmaganlari). Tarix yo'q bo'lsa — `students` ustunlari.
   */
  async statesFor(
    students: {
      id: number;
      discountPercent?: number | null;
      discountAmount?: number | null;
      discountReason?: string | null;
    }[],
  ): Promise<Map<number, BaseDiscountState[]>> {
    const out = new Map<number, BaseDiscountState[]>();
    if (!students.length) return out;
    const rows: any[] = await this.repo.query(
      `SELECT DISTINCT ON ("studentId", COALESCE("groupId", 0))
              "studentId", "groupId", "percent", "amount", "reason",
              TO_CHAR("fromMonth", 'YYYY-MM-01') AS "fromMonth"
         FROM "student_base_discounts"
        WHERE "studentId" = ANY($1::int[])
        ORDER BY "studentId", COALESCE("groupId", 0), "fromMonth" DESC`,
      [students.map((s) => s.id)],
    );
    for (const s of students) {
      const list: BaseDiscountState[] = rows
        .filter((r) => Number(r.studentId) === s.id)
        .map((r) => ({
          groupId: r.groupId == null ? null : Number(r.groupId),
          percent: Number(r.percent ?? 0),
          amount: Number(r.amount ?? 0),
          reason: r.reason ?? null,
          fromMonth: r.fromMonth,
        }));
      if (!list.some((x) => x.groupId === null)) {
        list.unshift({
          groupId: null,
          percent: Number(s.discountPercent ?? 0),
          amount: Number(s.discountAmount ?? 0),
          reason: s.discountReason ?? null,
          fromMonth: null,
        });
      }
      out.set(
        s.id,
        list.filter((x) => x.percent > 0 || x.amount > 0),
      );
    }
    return out;
  }

  private async upsertPeriod(
    studentId: number,
    p: Omit<BaseDiscountPeriod, 'monthlyFee'>,
  ): Promise<void> {
    await this.repo.query(
      `INSERT INTO "student_base_discounts"
              ("studentId", "fromMonth", "percent", "amount", "reason", "monthlyFee", "groupId")
       VALUES ($1, $2::date, $3, $4, $5, $6, $7)
       ON CONFLICT ("studentId", COALESCE("groupId", 0), "fromMonth")
       DO UPDATE SET "percent" = EXCLUDED."percent",
                     "amount" = EXCLUDED."amount",
                     "reason" = EXCLUDED."reason",
                     "monthlyFee" = COALESCE("student_base_discounts"."monthlyFee", EXCLUDED."monthlyFee")`,
      // Shaxsiy narx endi `student_group_fees` da — bu ustun yozilmaydi.
      [studentId, p.fromMonth, p.percent, p.amount, p.reason, null, p.groupId],
    );
  }

  /** Hali kuchga kirmagan (kelgusi oylardagi) qatorlarni o'chiradi. */
  private async clearFuturePeriods(
    studentId: number,
    groupId: number | null,
    currentMonth: string,
  ): Promise<void> {
    await this.repo.query(
      `DELETE FROM "student_base_discounts"
        WHERE "studentId" = $1 AND "fromMonth" > $2::date
          AND "groupId" IS NOT DISTINCT FROM $3::int`,
      [studentId, currentMonth, groupId],
    );
  }
}
