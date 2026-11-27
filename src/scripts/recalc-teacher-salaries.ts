/**
 * Bir martalik tuzatish: avans bilan "to'langan" bo'lib qotib qolgan oyliklarni
 * qayta hisoblaydi (2026-11-27 bug: avans oylikni to'liq qoplasa status 'paid'
 * bo'lib, keyingi tasdiqlangan cheklar oylikka qo'shilmay qolardi — pul
 * `teacher_commission_carryovers` da qo'llanmay turardi).
 *
 * Nima qiladi — yangi qoidalar bo'yicha MUZLAMAGAN (`isSalaryFrozen` emas)
 * har bir oylik qatori uchun, oylar o'sish tartibida:
 *   - o'qituvchi: `calculateTeacherEarningsForMonth({ force: true })` — shu oydan
 *     chiqib hech qayerga qo'shilmagan carryover o'z oyiga qaytadi, komissiya
 *     qayta hisoblanadi, oylik `resync` qilinadi;
 *   - boshqalar: `resync` (avans/jarima qayta qo'llanadi, holat qayta qo'yiladi).
 * Idempotent: ikkinchi marta ishga tushirilsa o'zgarish 0 bo'ladi.
 *
 * Ishga tushirish (build'dan keyin):
 *   node dist/src/scripts/recalc-teacher-salaries.js            # dry-run (default)
 *   node dist/src/scripts/recalc-teacher-salaries.js --apply    # yozadi
 *   ... --org=38                                                # bitta tashkilot
 *   ... --all     # ta'sirlanmagan, lekin eskirgan ochiq oyliklar ham
 *
 * Ta'sirlangan xodim — kamida bitta oyligi `status='paid' AND paidAmount=0`
 * yoki daromad hisoblangandan (`calculatedAt`) keyin tasdiqlangan cheki bor.
 * Uning barcha muzlamagan oyliklari qayta ko'riladi (avans FIFO oylar
 * orasida bog'langan).
 */
process.env.TELEGRAM_DISABLED = 'true';

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { dayjs } from '@/shared/utils/dayjs';
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';
import { StaffDeductionsService } from '@/modules/staff-salaries/staff-deductions.service';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';
import { UserRole } from '@/common/enums/user-role.enums';
import {
  isSalaryFrozen,
  round2,
  salaryCapacity,
  salaryRemaining,
  salaryStatusOf,
} from '@/modules/staff-salaries/salary-math';

interface SalaryRow {
  id: number;
  userId: number;
  forMonth: string;
  baseSalary: number;
  bonusAmount: number;
  deductionAmount: number;
  advanceAmount: number;
  paidAmount: number;
  status: string;
  role: string;
  organizationId: number;
  fullName: string;
  calculatedAt: string | null;
  receiptsAfterCalc: number;
}

interface DeductionRow {
  id: number;
  type: string;
  sourceForMonth: string;
  amount: number;
  appliedAmount: number;
}

interface AppRow {
  staffSalaryId: number;
  deductionId: number;
  amount: number;
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ORG = Number(args.find((a) => a.startsWith('--org='))?.slice(6) ?? 0);
/** Default — faqat ta'sirlangan xodimlar; `--all` — barcha muzlamagan oyliklar. */
const ALL = args.includes('--all');

const num = (v: unknown) => Number(v ?? 0);
const ym = (d: unknown) => dayjs(d as any).format('YYYY-MM-01');
const fmt = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/,/g, '.');

async function loadSalaries(ds: DataSource): Promise<SalaryRow[]> {
  const rows = await ds.query(
    `SELECT s."id", s."userId", s."forMonth", s."baseSalary", s."bonusAmount",
            s."deductionAmount", s."advanceAmount", s."paidAmount", s."status",
            u."role", u."organizationId",
            TRIM(CONCAT(u."firstName", ' ', u."lastName")) AS "fullName",
            e."calculatedAt",
            (SELECT COUNT(*) FROM "payment_receipts" r
               JOIN "payments" p ON p."id" = r."paymentId"
               JOIN "groups" g ON g."id" = p."groupId"
              WHERE r."status" = 'confirmed'
                AND p."forMonth" = s."forMonth"
                AND e."calculatedAt" IS NOT NULL
                AND r."confirmedAt" > e."calculatedAt"
                AND (g."teacherId" = s."userId" OR EXISTS (
                      SELECT 1 FROM "group_teacher_periods" tp
                       WHERE tp."groupId" = g."id" AND tp."teacherId" = s."userId"))
            )::int AS "receiptsAfterCalc"
       FROM "staff_salaries" s
       JOIN "users" u ON u."id" = s."userId"
       LEFT JOIN "teacher_monthly_earnings" e
              ON e."teacherId" = s."userId" AND e."forMonth" = s."forMonth"
      WHERE ($1::int = 0 OR u."organizationId" = $1)
      ORDER BY u."organizationId", s."userId", s."forMonth"`,
    [ORG],
  );
  return rows.map((r: any) => ({
    ...r,
    forMonth: ym(r.forMonth),
    baseSalary: num(r.baseSalary),
    bonusAmount: num(r.bonusAmount),
    deductionAmount: num(r.deductionAmount),
    advanceAmount: num(r.advanceAmount),
    paidAmount: num(r.paidAmount),
    receiptsAfterCalc: num(r.receiptsAfterCalc),
  }));
}

/** `StaffDeductionsService.resync` ning xotiradagi nusxasi (dry-run uchun). */
function simulateResync(
  s: SalaryRow,
  deductions: DeductionRow[],
  apps: AppRow[],
) {
  const byId = new Map(deductions.map((d) => [d.id, d]));
  // releaseExcess
  const room = s.baseSalary + s.bonusAmount - s.paidAmount;
  let excess = round2(s.deductionAmount - Math.max(0, room));
  if (excess > 0) {
    const mine = apps
      .filter((a) => a.staffSalaryId === s.id && a.amount > 0)
      .sort((a, b) => {
        const da = byId.get(a.deductionId)!;
        const db = byId.get(b.deductionId)!;
        return (
          db.sourceForMonth.localeCompare(da.sourceForMonth) ||
          b.deductionId - a.deductionId
        );
      });
    for (const app of mine) {
      if (excess <= 0) break;
      const back = round2(Math.min(app.amount, excess));
      const d = byId.get(app.deductionId)!;
      app.amount = round2(app.amount - back);
      d.appliedAmount = round2(d.appliedAmount - back);
      s.deductionAmount = round2(s.deductionAmount - back);
      if (d.type === StaffDeductionType.ADVANCE) {
        s.advanceAmount = round2(s.advanceAmount - back);
      }
      excess = round2(excess - back);
    }
  }
  // applyOutstanding
  let left = salaryCapacity(s);
  const monthEnd = dayjs(s.forMonth).endOf('month').format('YYYY-MM-DD');
  const open = deductions
    .filter((d) => d.sourceForMonth <= monthEnd && d.amount > d.appliedAmount)
    .sort(
      (a, b) => a.sourceForMonth.localeCompare(b.sourceForMonth) || a.id - b.id,
    );
  for (const d of open) {
    if (left <= 0) break;
    const take = round2(Math.min(d.amount - d.appliedAmount, left));
    if (take <= 0) continue;
    const app = apps.find(
      (a) => a.staffSalaryId === s.id && a.deductionId === d.id,
    );
    if (app) app.amount = round2(app.amount + take);
    else apps.push({ staffSalaryId: s.id, deductionId: d.id, amount: take });
    d.appliedAmount = round2(d.appliedAmount + take);
    s.deductionAmount = round2(s.deductionAmount + take);
    if (d.type === StaffDeductionType.ADVANCE) {
      s.advanceAmount = round2(s.advanceAmount + take);
    }
    left = round2(left - take);
  }
  s.status = salaryStatusOf(s);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const ds = app.get(DataSource);
  const earnings = app.get(TeacherEarningsService);
  const deductionsService = app.get(StaffDeductionsService);

  const all = await loadSalaries(ds);
  const byUser = new Map<number, SalaryRow[]>();
  for (const r of all) {
    const list = byUser.get(r.userId) ?? [];
    list.push(r);
    byUser.set(r.userId, list);
  }

  const report: string[] = [];
  const changedUsers: { userId: number; rows: SalaryRow[] }[] = [];
  let totalBaseDelta = 0;

  for (const [userId, rows] of byUser) {
    const affected = rows.some(
      (r) =>
        (r.status === 'paid' && r.paidAmount === 0) || r.receiptsAfterCalc > 0,
    );
    if (!ALL && !affected) continue;
    const open = rows.filter((r) => !isSalaryFrozen(r as any));
    if (!open.length) continue;

    const deductions: DeductionRow[] = (
      await ds.query(
        `SELECT "id", "type", "sourceForMonth", "amount", "appliedAmount"
           FROM "staff_deductions" WHERE "userId" = $1`,
        [userId],
      )
    ).map((d: any) => ({
      ...d,
      sourceForMonth: dayjs(d.sourceForMonth).format('YYYY-MM-DD'),
      amount: num(d.amount),
      appliedAmount: num(d.appliedAmount),
    }));
    const apps: AppRow[] = (
      await ds.query(
        `SELECT a."staffSalaryId", a."deductionId", a."amount"
           FROM "staff_salary_deductions" a
           JOIN "staff_deductions" d ON d."id" = a."deductionId"
          WHERE d."userId" = $1`,
        [userId],
      )
    ).map((a: any) => ({ ...a, amount: num(a.amount) }));
    const before = new Map(deductions.map((d) => [d.id, d.appliedAmount]));

    const lines: string[] = [];
    for (const r of open) {
      const old = { ...r };
      const sim = { ...r };
      let note = '';
      if (r.role === UserRole.TEACHER) {
        const p = await earnings.previewMonth(userId, r.forMonth);
        if (p && !p.frozen) {
          sim.baseSalary = round2(p.totalEarning);
          const parts = [
            `komissiya ${fmt(p.commissionAmount)}`,
            `carryover ${fmt(p.carryOverCommission)}`,
          ];
          if (p.absorbedCarryover) {
            parts.push(`o'z oyiga qaytgan ${fmt(p.absorbedCarryover)}`);
          }
          if (p.carriedOut)
            parts.push(`keyingi oyga o'tgan −${fmt(p.carriedOut)}`);
          note = parts.join(', ');
        }
      }
      simulateResync(sim, deductions, apps);
      Object.assign(r, sim);

      const changed =
        old.baseSalary !== sim.baseSalary ||
        old.deductionAmount !== sim.deductionAmount ||
        old.status !== sim.status;
      if (!changed) continue;
      const reason =
        old.status === 'paid' && old.paidAmount === 0
          ? 'avans bilan yopilgan'
          : old.receiptsAfterCalc > 0
            ? `hisobdan keyin ${old.receiptsAfterCalc} chek`
            : 'boshqa';
      totalBaseDelta += sim.baseSalary - old.baseSalary;
      lines.push(
        `| ${r.organizationId} | ${userId} ${r.fullName} | ${r.forMonth.slice(0, 7)} | ${reason} | ` +
          `${fmt(old.baseSalary)} → **${fmt(sim.baseSalary)}** | ` +
          `${fmt(old.advanceAmount)} → ${fmt(sim.advanceAmount)} | ` +
          `${fmt(old.deductionAmount - old.advanceAmount)} → ${fmt(sim.deductionAmount - sim.advanceAmount)} | ` +
          `${fmt(old.paidAmount)} | ` +
          `${fmt(salaryRemaining(old))} → **${fmt(salaryRemaining(sim))}** | ` +
          `${old.status} → ${sim.status} | ${note} |`,
      );
    }
    if (!lines.length) continue;
    report.push(...lines);
    const dLines = deductions
      .filter((d) => before.get(d.id) !== d.appliedAmount)
      .map(
        (d) =>
          `    ${d.type} #${d.id} (${fmt(d.amount)}): ushlangan ${fmt(before.get(d.id) ?? 0)} → ${fmt(d.appliedAmount)}`,
      );
    if (dLines.length)
      report.push(
        `|  | ${userId}: avans/jarima |  |  |  |  |  |  |  |  | ${dLines.join('; ').trim()} |`,
      );
    changedUsers.push({ userId, rows: open });
  }

  console.log(
    APPLY ? '\n=== APPLY ===' : '\n=== DRY-RUN (hech narsa yozilmadi) ===',
  );
  console.log(
    '| org | xodim | oy | sabab | baseSalary | avans | jarima | berilgan | qoldiq | holat | izoh |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const l of report) console.log(l);
  console.log(
    `\nXodimlar: ${changedUsers.length}, baseSalary jami o'zgarishi: ${fmt(round2(totalBaseDelta))}`,
  );

  if (APPLY) {
    for (const { userId, rows } of changedUsers) {
      for (const r of rows) {
        if (r.role === UserRole.TEACHER) {
          await earnings.calculateTeacherEarningsForMonth(
            r.organizationId,
            userId,
            r.forMonth.slice(0, 7),
            { force: true },
          );
        }
        // O'qituvchida calculate ham resync qiladi — takror chaqiruv idempotent.
        await deductionsService.resync(r.id);
      }
    }
    console.log(
      "Yozildi. Tekshirish uchun skriptni yana dry-run bilan ishga tushiring — 0 o'zgarish chiqishi kerak.",
    );
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
