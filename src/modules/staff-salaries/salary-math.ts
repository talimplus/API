/**
 * Oylik qatori hisobi — yagona joy (servislar, hisobot, o'qituvchi daromadi).
 *
 * - `earned`  — xodim shu oy uchun topgani: oylik + mukofot − jarimalar.
 * - `net`     — hozir qo'liga beriladigani: `earned − avans`
 *               (= baseSalary + bonusAmount − deductionAmount).
 * - `given`   — shu oy uchun berib bo'lingan pul: to'lovlar + avans.
 */
import { dayjs } from '@/shared/utils/dayjs';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';

export interface SalaryMoney {
  baseSalary?: number | string | null;
  bonusAmount?: number | string | null;
  deductionAmount?: number | string | null;
  advanceAmount?: number | string | null;
  paidAmount?: number | string | null;
}

export const round2 = (n: number): number =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const n = (v: unknown): number => Number(v ?? 0);

export const salaryNet = (s: SalaryMoney): number =>
  round2(
    Math.max(0, n(s.baseSalary) + n(s.bonusAmount) - n(s.deductionAmount)),
  );

export const salaryFines = (s: SalaryMoney): number =>
  round2(Math.max(0, n(s.deductionAmount) - n(s.advanceAmount)));

export const salaryEarned = (s: SalaryMoney): number =>
  round2(Math.max(0, n(s.baseSalary) + n(s.bonusAmount) - salaryFines(s)));

export const salaryRemaining = (s: SalaryMoney): number =>
  round2(Math.max(0, salaryNet(s) - n(s.paidAmount)));

/** Ushlab qolish mumkin bo'lgan qoldiq: hali berilmagan va ushlanmagan qism. */
export const salaryCapacity = (s: SalaryMoney): number =>
  round2(
    Math.max(
      0,
      n(s.baseSalary) +
        n(s.bonusAmount) -
        n(s.deductionAmount) -
        n(s.paidAmount),
    ),
  );

/**
 * Holat faqat berilgan puldan: `to'lovlar + avans >= topgani` bo'lsa "to'langan"
 * (= `paid >= net`). Jarima oylikni to'liq yesa ham "to'langan" — beriladigan
 * narsa qolmadi. Lekin hali hech narsa topilmagan oylik (0 so'm) "to'langan"
 * emas — aks holda oy boshida bo'sh qator darhol yopilib qolardi.
 */
export const salaryStatusOf = (s: SalaryMoney): StaffSalaryStatus => {
  const paid = n(s.paidAmount);
  const gross = n(s.baseSalary) + n(s.bonusAmount);
  if (gross > 0 && paid >= salaryNet(s)) return StaffSalaryStatus.PAID;
  return paid > 0 ? StaffSalaryStatus.PARTIAL : StaffSalaryStatus.UNPAID;
};

export interface FreezableSalary extends SalaryMoney {
  status?: StaffSalaryStatus | string | null;
  forMonth?: Date | string | null;
}

/**
 * Oylik MUZLATILGANMI — ya'ni keyin tushgan o'quvchi puli shu oyga emas,
 * carryover bo'lib keyingi oyga yoziladimi.
 *
 * Faqat o'tgan oy, haqiqatan pul berib (`paidAmount > 0`) yopilgan oylik.
 * Avans (yoki jarima) bilan yopilgan oylik muzlamaydi: o'qituvchi hali
 * hisob-kitob qilinmagan, yangi pul shu oyga qo'shiladi va qoldiq ko'rinadi.
 * Joriy oy ham muzlamaydi — oy tugamaguncha pul tushib turadi.
 * Pul ham, ushlanma ham yo'q "to'langan" o'tgan oy (eski import) — muzlagan.
 */
export const isSalaryFrozen = (s: FreezableSalary | null | undefined) => {
  if (!s || s.status !== StaffSalaryStatus.PAID || !s.forMonth) return false;
  const past = dayjs(s.forMonth)
    .startOf('month')
    .isBefore(dayjs().startOf('month'));
  if (!past) return false;
  return n(s.paidAmount) > 0 || n(s.deductionAmount) <= 0;
};

/** Pulni qanchasi berilgan bo'lsa holat shunga qarab (jarima oylikni yesa — "to'langan"). */
export const salaryMoneyView = (s: SalaryMoney) => ({
  baseSalary: n(s.baseSalary),
  bonusAmount: n(s.bonusAmount),
  deductionAmount: n(s.deductionAmount),
  advanceAmount: n(s.advanceAmount),
  fineAmount: salaryFines(s),
  earnedAmount: salaryEarned(s),
  netSalary: salaryNet(s),
  paidAmount: n(s.paidAmount),
  remaining: salaryRemaining(s),
  /** Shu oy uchun berilgan avans (+ jarima, berilgan pul) oylikdan shuncha ko'p. */
  overAmount: round2(
    Math.max(
      0,
      n(s.deductionAmount) +
        n(s.paidAmount) -
        n(s.baseSalary) -
        n(s.bonusAmount),
    ),
  ),
});
