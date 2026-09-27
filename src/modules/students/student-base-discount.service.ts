import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudentBaseDiscount } from '@/modules/students/entities/student-base-discount.entity';
import { DEFAULT_TIMEZONE } from '@/modules/groups/group-fee.service';
import { dayjs } from '@/shared/utils/dayjs';

/** Oyga bog'langan doimiy chegirma qatori. */
export interface BaseDiscountPeriod {
  fromMonth: string; // YYYY-MM-01
  percent: number;
  amount: number;
  reason: string | null;
  /** Shaxsiy narx (0 — guruh narxi); null — tarixda yo'q, `students` dan. */
  monthlyFee: number | null;
}

export interface BaseDiscountValue {
  percent: number;
  amount: number;
  reason: string | null;
  monthlyFee: number;
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
 * O'quvchining doimiy chegirmasi VA shaxsiy narxini oy aniqligida boshqaradi
 * (ikkalasi bitta tarixda: bir oy uchun bitta "narx sharti" qatori).
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
              "percent", "amount", "reason", "monthlyFee"
         FROM "student_base_discounts"
        WHERE "studentId" = $1
        ORDER BY "fromMonth" ASC`,
      [studentId],
    );
    return (rows ?? []).map((r: any) => ({
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
  ): Promise<boolean> {
    const rows = await this.repo.query(
      `SELECT 1
         FROM "payments" p
        WHERE p."studentId" = $1
          AND p."forMonth" = $2::date
          AND (
            p."amountPaid" > 0
            OR EXISTS (
              SELECT 1 FROM "payment_receipts" r
               WHERE r."paymentId" = p."id" AND r."status" = 'pending'
            )
          )
        LIMIT 1`,
      [studentId, forMonth],
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
  ): Promise<{ effectiveFrom: string | null }> {
    const current = this.currentMonth();
    const periods = await this.getPeriods(studentId);
    const inEffect = pickBaseDiscountForMonth(periods, current) ?? {
      fromMonth: current,
      ...previous,
    };
    const inEffectFee = inEffect.monthlyFee ?? previous.monthlyFee;

    const sameAsNow =
      inEffect.percent === next.percent &&
      inEffect.amount === next.amount &&
      inEffectFee === next.monthlyFee;
    if (sameAsNow) {
      // Qiymat aslida o'zgarmayapti — rejalashtirilgan kelgusi o'zgarish
      // bo'lsa bekor qilinadi (admin fikridan qaytdi).
      await this.clearFuturePeriods(studentId, current);
      return { effectiveFrom: null };
    }

    const from = (await this.hasMoneyForMonth(studentId, current))
      ? dayjs(current).add(1, 'month').format('YYYY-MM-01')
      : current;

    if (!periods.length) {
      // Birinchi o'zgarish: eski qiymatni tarixga yozamiz, shunda `from` dan
      // oldingi oylar (qatorlar bo'lmagan oylar ham) eski chegirmada qoladi.
      const baselineMonth = dayjs(from)
        .subtract(1, 'month')
        .format('YYYY-MM-01');
      await this.upsertPeriod(studentId, {
        fromMonth: baselineMonth,
        ...previous,
      });
    }

    await this.clearFuturePeriods(studentId, current);
    await this.upsertPeriod(studentId, { fromMonth: from, ...next });
    return { effectiveFrom: from };
  }

  private async upsertPeriod(
    studentId: number,
    p: Omit<BaseDiscountPeriod, 'monthlyFee'> & { monthlyFee: number | null },
  ): Promise<void> {
    await this.repo.query(
      `INSERT INTO "student_base_discounts"
              ("studentId", "fromMonth", "percent", "amount", "reason", "monthlyFee")
       VALUES ($1, $2::date, $3, $4, $5, $6)
       ON CONFLICT ("studentId", "fromMonth")
       DO UPDATE SET "percent" = EXCLUDED."percent",
                     "amount" = EXCLUDED."amount",
                     "reason" = EXCLUDED."reason",
                     "monthlyFee" = EXCLUDED."monthlyFee"`,
      [studentId, p.fromMonth, p.percent, p.amount, p.reason, p.monthlyFee],
    );
  }

  /** Hali kuchga kirmagan (kelgusi oylardagi) qatorlarni o'chiradi. */
  private async clearFuturePeriods(
    studentId: number,
    currentMonth: string,
  ): Promise<void> {
    await this.repo.query(
      `DELETE FROM "student_base_discounts"
        WHERE "studentId" = $1 AND "fromMonth" > $2::date`,
      [studentId, currentMonth],
    );
  }
}
