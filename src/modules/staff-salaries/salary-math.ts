/**
 * Oylik qatori hisobi — yagona joy (servislar, hisobot, o'qituvchi daromadi).
 *
 * - `earned`  — xodim shu oy uchun topgani: oylik + mukofot − jarimalar.
 * - `net`     — hozir qo'liga beriladigani: `earned − avans`
 *               (= baseSalary + bonusAmount − deductionAmount).
 * - `given`   — shu oy uchun berib bo'lingan pul: to'lovlar + avans.
 */
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
});
