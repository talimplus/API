/**
 * Ssenariy testi (jest ishlamaydi — CLAUDE.md §9): avans bilan yopilgan
 * o'qituvchi oyligi keyin tushgan pul bilan qayta hisoblanishi.
 * Prod holati: user 358 (org 38) — oktyabr/noyabr oyliklari avans bilan
 * 'paid' bo'lib qotgan, keyingi cheklar `teacher_commission_carryovers` da
 * qo'llanmay qolgan.
 *
 * FAQAT NUSXA BAZADA ishga tushiriladi (ma'lumotni o'chiradi/yozadi):
 *   createdb -T li_tech li_tech_salary_test
 *   npm run build
 *   DB_NAME=li_tech_salary_test node dist/src/scripts/salary-advance-recalc.scenario.js
 *   dropdb li_tech_salary_test
 *
 * Joriy oy = bugungi oy; "o'tgan oy" = undan oldingisi.
 */
process.env.TELEGRAM_DISABLED = 'true';

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { dayjs } from '@/shared/utils/dayjs';
import { PaymentsService } from '@/modules/payments/payments.service';
import { StaffSalariesService } from '@/modules/staff-salaries/staff-salaries.service';
import { StaffDeductionsService } from '@/modules/staff-salaries/staff-deductions.service';
import { StaffSalaryDetailsService } from '@/modules/staff-salaries/staff-salary-details.service';
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';
import { UserRole } from '@/common/enums/user-role.enums';
import { salaryRemaining } from '@/modules/staff-salaries/salary-math';

const ORG = 1;
const TEACHER = 2; // 50% komissiya
const GROUP = 2;
const ADMIN = { userId: 1, role: UserRole.ADMIN, organizationId: ORG } as any;

const PREV = dayjs().subtract(1, 'month').format('YYYY-MM-01');
const CUR = dayjs().format('YYYY-MM-01');

let failed = 0;
let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else failed++;
  console.log(
    `${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (kutilgan ${JSON.stringify(expected)})`}`,
  );
}

async function main() {
  if (!/test|copy/.test(process.env.DB_NAME ?? '')) {
    throw new Error('Faqat nusxa bazada: DB_NAME=..._test');
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const ds = app.get(DataSource);
  const payments = app.get(PaymentsService);
  const salaries = app.get(StaffSalariesService);
  const deductions = app.get(StaffDeductionsService);
  const earnings = app.get(TeacherEarningsService);
  const details = app.get(StaffSalaryDetailsService);

  // ── Toza boshlang'ich holat ─────────────────────────────────────
  const reset = async () => {
    await ds.query(
      `UPDATE "users" SET "salary" = 0, "commissionPercentage" = 50 WHERE "id" = $1`,
      [TEACHER],
    );
    await ds.query(`DELETE FROM "user_pay_periods" WHERE "userId" = $1`, [
      TEACHER,
    ]);
    await ds.query(
      `DELETE FROM "staff_salary_payments" WHERE "staffSalaryId" IN (SELECT "id" FROM "staff_salaries" WHERE "userId" = $1)`,
      [TEACHER],
    );
    await ds.query(
      `DELETE FROM "staff_salary_deductions" WHERE "staffSalaryId" IN (SELECT "id" FROM "staff_salaries" WHERE "userId" = $1)`,
      [TEACHER],
    );
    await ds.query(`DELETE FROM "staff_deductions" WHERE "userId" = $1`, [
      TEACHER,
    ]);
    await ds.query(`DELETE FROM "staff_bonuses" WHERE "userId" = $1`, [
      TEACHER,
    ]);
    await ds.query(`DELETE FROM "staff_salaries" WHERE "userId" = $1`, [
      TEACHER,
    ]);
    await ds.query(
      `DELETE FROM "teacher_monthly_earnings" WHERE "teacherId" = $1`,
      [TEACHER],
    );
    await ds.query(
      `DELETE FROM "teacher_commission_carryovers" WHERE "teacherId" = $1`,
      [TEACHER],
    );
    await ds.query(
      `DELETE FROM "payments" WHERE "forMonth" IN ($1, $2) AND "groupId" IN (
         SELECT "id" FROM "groups" WHERE "teacherId" = $3
         UNION SELECT "groupId" FROM "group_teacher_periods" WHERE "teacherId" = $3)`,
      [PREV, CUR, TEACHER],
    );
  };
  await reset();
  const students: { id: number }[] = await ds.query(
    `SELECT s."id" FROM "students" s JOIN "centers" c ON c."id" = s."centerId"
      WHERE c."organizationId" = $1 ORDER BY s."id" LIMIT 3`,
    [ORG],
  );
  const mkPayment = async (studentId: number, month: string) => {
    const [row] = await ds.query(
      `INSERT INTO "payments" ("studentId", "groupId", "forMonth", "amountDue", "amountPaid", "status")
       VALUES ($1, $2, $3, 5000000, 0, 'unpaid') RETURNING "id"`,
      [studentId, GROUP, month],
    );
    return Number(row.id);
  };
  const pPrev = await mkPayment(students[0].id, PREV);
  const pCur = await mkPayment(students[1].id, CUR);

  const pay = async (paymentId: number, amount: number) => {
    // Admin qabul qilsa chek darhol tasdiqlanadi (confirm oqimi bilan bir xil).
    await payments.submitReceipt(paymentId, amount, ADMIN);
    // Daromad qayta hisobi fire-and-forget — u bilan parallel yana hisoblaymiz
    // (qulf ikki marta ushlamasligini ham tekshiradi), keyin kutamiz.
    await payments.recalcTeacherEarningsForGroupMonth(
      GROUP,
      dayjs(PREV).format('YYYY-MM-01'),
    );
    await payments.recalcTeacherEarningsForGroupMonth(GROUP, CUR);
    await new Promise((r) => setTimeout(r, 500));
  };
  const row = async (month: string) => {
    const [s] = await ds.query(
      `SELECT * FROM "staff_salaries" WHERE "userId" = $1 AND "forMonth" = $2`,
      [TEACHER, month],
    );
    if (!s) return null;
    return {
      base: Number(s.baseSalary),
      advance: Number(s.advanceAmount),
      paid: Number(s.paidAmount),
      status: s.status,
      remaining: salaryRemaining(s),
    };
  };
  const list = (month: string) => salaries.findAll(ORG, month.slice(0, 7));

  // ── 1. Avans oylikni to'liq qoplaydi ────────────────────────────
  await pay(pPrev, 400000); // o'tgan oy: 200 000 komissiya
  await pay(pCur, 300000); // joriy oy: 150 000 komissiya
  await list(PREV);
  await list(CUR);
  await deductions.createAdvance(
    { userId: TEACHER, amount: 300000, forMonth: PREV.slice(0, 7) } as any,
    ADMIN,
  );
  await list(PREV);
  await list(CUR);
  check("1a. o'tgan oy avans bilan yopildi", await row(PREV), {
    base: 200000,
    advance: 200000,
    paid: 0,
    status: 'paid',
    remaining: 0,
  });
  check("1b. joriy oy — avans qoldig'i 100 000", await row(CUR), {
    base: 150000,
    advance: 100000,
    paid: 0,
    status: 'unpaid',
    remaining: 50000,
  });

  // ── 2. Keyin yangi chek tasdiqlanadi → oylik oshadi, 'paid' emas ──
  await pay(pPrev, 600000); // +300 000 komissiya
  // Avans o'zi tanlangan oyga qaytadi: noyabrdagi 100 000 ham oktyabrga.
  check("2a. o'tgan oy oshdi, avans to'liq o'z oyiga qaytdi", await row(PREV), {
    base: 500000,
    advance: 300000,
    paid: 0,
    status: 'unpaid',
    remaining: 200000,
  });
  check('2a2. joriy oydan avans olib tashlandi', await row(CUR), {
    base: 150000,
    advance: 0,
    paid: 0,
    status: 'unpaid',
    remaining: 150000,
  });
  const [carry] = await ds.query(
    `SELECT COUNT(*)::int AS n FROM "teacher_commission_carryovers" WHERE "teacherId" = $1`,
    [TEACHER],
  );
  check("2b. carryover yozilmadi (pul o'z oyiga tushdi)", carry.n, 0);
  const [adv] = await ds.query(
    `SELECT "appliedAmount", "settledAt" IS NOT NULL AS settled FROM "staff_deductions" WHERE "userId" = $1`,
    [TEACHER],
  );
  check(
    '2c. avans ikki marta ushlanmadi',
    [Number(adv.appliedAmount), adv.settled],
    [300000, true],
  );
  const [dups] = await ds.query(
    `SELECT COUNT(*)::int AS n FROM "staff_salary_deductions" a JOIN "staff_salaries" s ON s."id" = a."staffSalaryId" WHERE s."userId" = $1`,
    [TEACHER],
  );
  check('2d. staff_salary_deductions dublikatsiz (1 qator)', dups.n, 1);

  // ── 3. Yangi avans keyin beriladi → ochiq oyga qo'llanadi ───────
  await deductions.createAdvance(
    { userId: TEACHER, amount: 250000, forMonth: PREV.slice(0, 7) } as any,
    ADMIN,
  );
  check(
    "3. ikkinchi avans o'tgan oydan ushlandi (200 000 sig'di)",
    await row(PREV),
    {
      base: 500000,
      advance: 500000,
      paid: 0,
      status: 'paid',
      remaining: 0,
    },
  );
  check("3b. sig'magan 50 000 joriy oydan", (await row(CUR))?.advance, 50000);

  // ── 4. Rad etilgan chek summani oshirmaydi ──────────────────────
  // Admin bo'lmagan xodim qabul qilgan chek — `pending`, keyin rad etiladi.
  const RECEPTION = {
    userId: TEACHER,
    role: UserRole.TEACHER,
    organizationId: ORG,
  } as any;
  const pending: any = await payments.submitReceipt(pCur, 200000, RECEPTION);
  await payments.rejectReceipt(
    pending?.receipt?.id ?? pending?.id,
    ADMIN,
    'test',
  );
  await payments.recalcTeacherEarningsForGroupMonth(GROUP, CUR);
  check(
    "4. rad etilgan chek — joriy oy o'zgarmadi",
    (await row(CUR))?.base,
    150000,
  );

  // ── 5. Tushum kamaysa (qaytarildi) → oylik kamayadi, ortiqcha avans qaytadi ──
  await ds.query(
    `UPDATE "payments" SET "amountPaid" = 100000, "refundedAmount" = 900000, "status" = 'partial' WHERE "id" = $1`,
    [pPrev],
  );
  await payments.recalcTeacherEarningsForGroupMonth(GROUP, PREV);
  check(
    "5a. o'tgan oy 50 000 ga tushdi, ortiqcha avans qaytdi",
    await row(PREV),
    {
      base: 50000,
      advance: 50000,
      paid: 0,
      status: 'paid',
      remaining: 0,
    },
  );
  await list(CUR);
  check("5b. qaytgan avans joriy oyga o'tdi", await row(CUR), {
    base: 150000,
    advance: 150000,
    paid: 0,
    status: 'paid',
    remaining: 0,
  });
  const [open] = await ds.query(
    `SELECT COALESCE(SUM("amount" - "appliedAmount"), 0)::numeric AS left FROM "staff_deductions" WHERE "userId" = $1`,
    [TEACHER],
  );
  check('5c. ochiq avans 350 000 (550 − 50 − 150)', Number(open.left), 350000);

  // ── 6. Joriy oy avans bilan 'paid' bo'lsa ham yangi pul qo'shiladi ──
  await pay(pCur, 400000); // joriy oy: 700 000 → 350 000 komissiya
  check('6. joriy oy oshdi, avans yana ushlandi', await row(CUR), {
    base: 350000,
    advance: 350000,
    paid: 0,
    status: 'paid',
    remaining: 0,
  });

  // ── 7. Pul berib yopilgan O'TGAN oy muzlaydi → carryover (eski qoida) ──
  await ds.query(
    `UPDATE "payments" SET "amountPaid" = 1600000, "refundedAmount" = 0 WHERE "id" = $1`,
    [pPrev],
  );
  await payments.recalcTeacherEarningsForGroupMonth(GROUP, PREV);
  const prevRow = await row(PREV);
  const [sal] = await ds.query(
    `SELECT "id" FROM "staff_salaries" WHERE "userId" = $1 AND "forMonth" = $2`,
    [TEACHER, PREV],
  );
  await salaries.pay(sal.id, { amount: prevRow!.remaining } as any, ADMIN);
  check("7a. o'tgan oy pul bilan yopildi", (await row(PREV))?.status, 'paid');
  await pay(pPrev, 600000); // +300 000 komissiya muzlagan oyga
  check("7b. muzlagan oy o'zgarmadi", (await row(PREV))?.base, 800000);
  const carries: any[] = await ds.query(
    `SELECT "amount", "appliedForMonth" FROM "teacher_commission_carryovers" WHERE "teacherId" = $1`,
    [TEACHER],
  );
  check(
    "7c. carryover joriy oyga qo'shildi",
    carries.map((c) => [
      Number(c.amount),
      dayjs(c.appliedForMonth).format('YYYY-MM-01'),
    ]),
    [[300000, CUR]],
  );
  check(
    '7d. joriy oy = 350 000 + 300 000 carryover',
    (await row(CUR))?.base,
    650000,
  );

  // ── 8. Prod holati: eski kod bilan qotib qolgan oy + qo'llanmagan carryover ──
  // O'tgan oyni yana avans bilan yopilgan holatga keltiramiz (paidAmount = 0)
  // va eski kod yozgan qo'llanmagan carryover'ni qo'shamiz.
  await ds.query(
    `DELETE FROM "staff_salary_payments" WHERE "staffSalaryId" = $1`,
    [sal.id],
  );
  await ds.query(
    `UPDATE "staff_salaries" SET "paidAmount" = 0, "status" = 'paid' WHERE "id" = $1`,
    [sal.id],
  );
  await ds.query(
    `INSERT INTO "teacher_commission_carryovers" ("teacherId", "sourceForMonth", "amount") VALUES ($1, $2, 120000)`,
    [TEACHER, PREV],
  );
  const preview = await earnings.previewMonth(TEACHER, PREV);
  check(
    "8a. preview: carryover o'z oyiga qaytadi",
    preview && !preview.frozen ? preview.absorbedCarryover : null,
    120000,
  );
  await earnings.calculateTeacherEarningsForMonth(
    ORG,
    TEACHER,
    PREV.slice(0, 7),
    { force: true },
  );
  const [left] = await ds.query(
    `SELECT COUNT(*)::int AS n FROM "teacher_commission_carryovers" WHERE "teacherId" = $1 AND "appliedForMonth" IS NULL`,
    [TEACHER],
  );
  check("8b. qo'llanmagan carryover o'chdi", left.n, 0);
  // 2 200 000 × 50% = 1 100 000 − joriy oyga o'tib bo'lgan 300 000 = 800 000
  check(
    "8c. o'tgan oy: 50% × tushum − o'tkazilgan",
    (await row(PREV))?.base,
    800000,
  );

  // ── 9. Prod holati (user 358): noyabr oktyabrdan OLDIN hisoblanadi ──
  // Oktyabr avanslari (200 000 + 800 000) oktyabr oyligi kichik paytda
  // berilgan; keyin oktyabr puli kelgan. Avans oktyabrga qaytishi kerak.
  await reset();
  const o1 = await mkPayment(students[0].id, PREV);
  const n1 = await mkPayment(students[1].id, CUR);
  const n2 = await mkPayment(students[2].id, CUR);
  const payCurFirst = async (paymentId: number, amount: number) => {
    await payments.submitReceipt(paymentId, amount, ADMIN);
    await payments.recalcTeacherEarningsForGroupMonth(GROUP, CUR);
    await payments.recalcTeacherEarningsForGroupMonth(GROUP, PREV);
    await new Promise((r) => setTimeout(r, 500));
  };
  await payCurFirst(o1, 414692.32); // oktyabr ustamasi 207 346.16
  await payCurFirst(n1, 1500000);
  await payCurFirst(n2, 580307.7); // noyabr ustamasi 1 040 153.85
  await list(CUR);
  await list(PREV);
  const giveAdvance = async (amount: number, month: string, comment: string) =>
    deductions.createAdvance(
      { userId: TEACHER, amount, forMonth: month.slice(0, 7), comment } as any,
      ADMIN,
    );
  const a2 = await giveAdvance(200000, PREV, 'Oktyabr oyligidan berildi');
  const a3: any = await giveAdvance(800000, PREV, 'Oktyabr oyidan avans');
  check(
    '9a. avans javobida taqsimot (oktyabr 7 346.16, noyabr 792 653.84)',
    a3.allocations.map((x: any) => [x.month, x.amount]),
    [
      [PREV, 7346.16],
      [CUR, 792653.84],
    ],
  );
  await giveAdvance(250000, CUR, 'abubakir');
  await list(CUR);
  await list(PREV);
  await payCurFirst(o1, 1040000); // oktyabr ustamasi 727 346.16 ga oshdi
  await list(CUR);
  await list(PREV);
  check("9b. oktyabr: avans bilan to'liq yopildi, qoldiq 0", await row(PREV), {
    base: 727346.16,
    advance: 727346.16,
    paid: 0,
    status: 'paid',
    remaining: 0,
  });
  check('9c. noyabr: qoldiq 517 500.01', await row(CUR), {
    base: 1040153.85,
    advance: 522653.84,
    paid: 0,
    status: 'unpaid',
    remaining: 517500.01,
  });
  check(
    '9d. avans qarzi 0',
    await deductions.getOutstanding(TEACHER, 'advance' as any),
    0,
  );
  const [prevSal] = await ds.query(
    `SELECT "id" FROM "staff_salaries" WHERE "userId" = $1 AND "forMonth" = $2`,
    [TEACHER, PREV],
  );
  const d9: any = await details.details(ORG, prevSal.id);
  check('9e. batafsil: yakuniy hisob', d9.totals, {
    calculated: 727346.16,
    advance: 727346.16,
    fines: 0,
    paid: 0,
    remaining: 0,
  });
  check(
    '9f. batafsil: 800 000 avans — oktyabrdan 527 346.16, noyabrdan 272 653.84',
    d9.advances
      .filter((x: any) => x.id === a3.id)
      .map((x: any) => [x.thisMonth, x.allocations.map((y: any) => y.amount)]),
    [[527346.16, [527346.16, 272653.84]]],
  );
  check(
    "9g. batafsil: ustama guruh bo'yicha",
    d9.commission.groups.map((g: any) => [g.groupId, g.paid, g.share]),
    [[GROUP, 1454692.32, 727346.16]],
  );
  void a2;
  const [dupes] = await ds.query(
    `SELECT COUNT(*)::int AS n FROM (SELECT "staffSalaryId", "deductionId" FROM "staff_salary_deductions"
       GROUP BY 1, 2 HAVING COUNT(*) > 1) x`,
  );
  check("9h. dublikat yo'q", dupes.n, 0);

  // ── 10. Pul berib yopilgan oyga kech to'lov → o'tkazma sababi bilan ──
  await payCurFirst(o1, 600000); // oktyabr 1 027 346.16 — avanslardan oshdi
  await list(PREV);
  const prev10 = await row(PREV);
  check("10a. oktyabr qoldig'i 27 346.16", prev10?.remaining, 27346.16);
  await salaries.pay(prevSal.id, { amount: prev10!.remaining } as any, ADMIN);
  await payCurFirst(o1, 100000); // +50 000 ustama yopilgan oktyabrga
  check(
    "10b. yopilgan oktyabr o'zgarmadi",
    (await row(PREV))?.base,
    1027346.16,
  );
  const [curSal] = await ds.query(
    `SELECT "id" FROM "staff_salaries" WHERE "userId" = $1 AND "forMonth" = $2`,
    [TEACHER, CUR],
  );
  const d10: any = await details.details(ORG, curSal.id);
  check(
    "10c. noyabrga o'tkazma: o'quvchi, guruh, to'lov sanasi bilan",
    d10.transfers.in.map((t: any) => [
      t.amount,
      t.fromMonth,
      t.student?.id,
      t.group?.id,
      !!t.paidAt,
    ]),
    [[50000, PREV, students[0].id, GROUP, true]],
  );
  check(
    '10d. noyabr = 1 040 153.85 + 50 000',
    (await row(CUR))?.base,
    1090153.85,
  );

  console.log(`\n${passed} ✅, ${failed} ❌`);
  await app.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
