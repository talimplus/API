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

/**
 * `StaffDeductionsService.rebuildUserTx` ning xotiradagi nusxasi (dry-run):
 * muzlagan oyliklardagi ushlanmalar o'zgarmas, qolgan oylar eskidan yangiga
 * to'ldiriladi. Avans — faqat o'z oyiga; jarima — sig'gancha, eskidan yangiga.
 */
function simulateRebuild(
  rows: SalaryRow[],
  deductions: DeductionRow[],
  apps: AppRow[],
): AppRow[] {
  const frozen = new Set(
    rows.filter((r) => isSalaryFrozen(r as any)).map((r) => r.id),
  );
  const left = new Map(deductions.map((d) => [d.id, d.amount]));
  const next: AppRow[] = [];
  for (const a of apps) {
    if (!frozen.has(a.staffSalaryId)) continue;
    next.push({ ...a });
    left.set(a.deductionId, round2((left.get(a.deductionId) ?? 0) - a.amount));
  }
  const ordered = [...deductions].sort(
    (x, y) => x.sourceForMonth.localeCompare(y.sourceForMonth) || x.id - y.id,
  );
  const add = (staffSalaryId: number, deductionId: number, amount: number) => {
    const ex = next.find(
      (a) => a.staffSalaryId === staffSalaryId && a.deductionId === deductionId,
    );
    if (ex) ex.amount = round2(ex.amount + amount);
    else next.push({ staffSalaryId, deductionId, amount });
  };
  // Avans — faqat o'z oyiga, to'liq (o'zi ko'chmaydi).
  for (const d of ordered) {
    if (d.type !== StaffDeductionType.ADVANCE) continue;
    const own = rows.find((r) => r.forMonth === d.sourceForMonth);
    const rest = left.get(d.id) ?? 0;
    if (!own || rest <= 0) continue;
    add(own.id, d.id, rest);
    left.set(d.id, 0);
  }
  // Jarima — sig'gancha, eskidan yangiga.
  for (const r of [...rows].sort((x, y) =>
    x.forMonth.localeCompare(y.forMonth),
  )) {
    if (frozen.has(r.id)) continue;
    const adv = next
      .filter((a) => a.staffSalaryId === r.id)
      .filter(
        (a) =>
          deductions.find((d) => d.id === a.deductionId)?.type ===
          StaffDeductionType.ADVANCE,
      )
      .reduce((sum, a) => sum + a.amount, 0);
    let room = round2(
      Math.max(0, r.baseSalary + r.bonusAmount - r.paidAmount - adv),
    );
    for (const d of ordered) {
      if (room <= 0) break;
      if (d.type === StaffDeductionType.ADVANCE) continue;
      if (d.sourceForMonth > r.forMonth) continue;
      const take = round2(Math.min(left.get(d.id) ?? 0, room));
      if (take <= 0) continue;
      add(r.id, d.id, take);
      left.set(d.id, round2((left.get(d.id) ?? 0) - take));
      room = round2(room - take);
    }
  }
  const typeOf = new Map(deductions.map((d) => [d.id, d.type]));
  for (const r of rows) {
    const mine = next.filter((a) => a.staffSalaryId === r.id);
    r.deductionAmount = round2(mine.reduce((sum, a) => sum + a.amount, 0));
    r.advanceAmount = round2(
      mine
        .filter((a) => typeOf.get(a.deductionId) === StaffDeductionType.ADVANCE)
        .reduce((sum, a) => sum + a.amount, 0),
    );
    if (!frozen.has(r.id)) r.status = salaryStatusOf(r);
  }
  for (const d of deductions) {
    d.appliedAmount = round2(d.amount - (left.get(d.id) ?? 0));
  }
  return next;
}

/** Shu oy uchun avans (+ jarima, berilgan pul) oylikdan qancha ko'p. */
const overOf = (r: SalaryRow) =>
  round2(
    Math.max(
      0,
      r.deductionAmount + r.paidAmount - r.baseSalary - r.bonusAmount,
    ),
  );

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
  const changedUsers: {
    userId: number;
    rows: SalaryRow[];
    recalcBase: boolean;
  }[] = [];
  let totalBaseDelta = 0;

  for (const [userId, rows] of byUser) {
    const affected = rows.some(
      (r) =>
        (r.status === 'paid' && r.paidAmount === 0) || r.receiptsAfterCalc > 0,
    );
    // Oylikni qayta hisoblash — faqat ta'sirlangan xodimlarda (yoki --all).
    // Avans/jarima taqsimoti esa hamma xodimda qayta quriladi.
    const recalcBase = ALL || affected;

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

    const olds = rows.map((r) => ({ ...r }));
    const notes = new Map<number, string>();
    for (const r of rows) {
      if (!recalcBase || r.role !== UserRole.TEACHER) continue;
      if (isSalaryFrozen(r as any)) continue;
      const p = await earnings.previewMonth(userId, r.forMonth);
      if (!p || p.frozen) continue;
      r.baseSalary = round2(p.totalEarning);
      const parts = [`ustama ${fmt(p.commissionAmount)}`];
      if (p.carryOverCommission) {
        parts.push(`boshqa oydan +${fmt(p.carryOverCommission)}`);
      }
      if (p.carriedOut) parts.push(`keyingi oyga −${fmt(p.carriedOut)}`);
      if (p.absorbedCarryover) {
        parts.push(`o'z oyiga qaytgan ${fmt(p.absorbedCarryover)}`);
      }
      notes.set(r.id, parts.join(', '));
    }
    const nextApps = simulateRebuild(rows, deductions, apps);

    const lines: string[] = [];
    rows.forEach((r, i) => {
      const old = olds[i];
      if (
        old.baseSalary === r.baseSalary &&
        old.deductionAmount === r.deductionAmount &&
        old.advanceAmount === r.advanceAmount &&
        old.status === r.status
      ) {
        return;
      }
      totalBaseDelta += r.baseSalary - old.baseSalary;
      const by = nextApps
        .filter((a) => a.staffSalaryId === r.id)
        .map((a) => `#${a.deductionId} ${fmt(a.amount)}`)
        .join(' + ');
      lines.push(
        `| ${r.organizationId} | ${userId} ${r.fullName} | ${r.forMonth.slice(0, 7)} | ` +
          `${fmt(old.baseSalary)} → ${fmt(r.baseSalary)} | ` +
          `${fmt(old.deductionAmount)} → **${fmt(r.deductionAmount)}** | ` +
          `${fmt(r.paidAmount)} | ` +
          `${fmt(salaryRemaining(old))} → **${fmt(salaryRemaining(r))}** | ` +
          `${old.status} → ${r.status}${overOf(r) > 0 ? ` · avans oylikdan ${fmt(overOf(r))} ko'p` : ''} | ${[by && `ushlanadi: ${by}`, notes.get(r.id)].filter(Boolean).join('; ')} |`,
      );
    });
    // Faqat ichki taqsimot o'zgargan bo'lsa ham (summalar bir xil) — yoziladi.
    const key = (a: AppRow) =>
      `${a.staffSalaryId}:${a.deductionId}:${round2(a.amount)}`;
    const appsChanged =
      apps
        .filter((a) => a.amount > 0)
        .map(key)
        .sort()
        .join() !== nextApps.map(key).sort().join();
    if (!lines.length && !appsChanged) continue;
    report.push(...lines);
    const dLines = deductions
      .filter((d) => before.get(d.id) !== d.appliedAmount)
      .map(
        (d) =>
          `${d.type === StaffDeductionType.ADVANCE ? 'avans' : 'jarima'} #${d.id} (${fmt(d.amount)}): ushlangan ${fmt(before.get(d.id) ?? 0)} → ${fmt(d.appliedAmount)}, qarz ${fmt(round2(d.amount - d.appliedAmount))}`,
      );
    if (dLines.length || (appsChanged && !lines.length)) {
      report.push(
        `|  | ${userId} ${rows[0].fullName} |  |  |  |  |  |  | ${dLines.join('; ') || "faqat oylar orasidagi taqsimot o'zgaradi (summalar bir xil)"} |`,
      );
    }
    changedUsers.push({ userId, rows, recalcBase });
  }

  console.log(
    APPLY ? '\n=== APPLY ===' : '\n=== DRY-RUN (hech narsa yozilmadi) ===',
  );
  console.log(
    '| org | xodim | oy | hisoblangan oylik | ushlangan (avans+jarima) | berilgan | qoldiq | holat | izoh |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const l of report) console.log(l);
  console.log(
    `\nXodimlar: ${changedUsers.length}, baseSalary jami o'zgarishi: ${fmt(round2(totalBaseDelta))}`,
  );

  if (APPLY) {
    for (const { userId, rows, recalcBase } of changedUsers) {
      if (recalcBase) {
        for (const r of rows) {
          if (r.role !== UserRole.TEACHER || isSalaryFrozen(r as any)) continue;
          await earnings.calculateTeacherEarningsForMonth(
            r.organizationId,
            userId,
            r.forMonth.slice(0, 7),
            { force: true },
          );
        }
      }
      // Avans/jarima taqsimotini noldan qayta quradi (idempotent).
      await deductionsService.rebuildUser(userId);
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
