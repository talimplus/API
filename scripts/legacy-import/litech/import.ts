/**
 * LITECH markazining iyun–sentabr 2026 tarixini tizimga ko'chiradi.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/legacy-import/litech/import.ts "new-data/LITECH 2026.xlsx" --apply [--reset]
 *
 * --apply  bazaga yozadi (bo'lmasa faqat model hisobotini chiqaradi)
 * --reset  avval shu filialdagi barcha ma'lumotni o'chiradi (admin foydalanuvchi qoladi)
 *
 * Pul hisobini skript o'zi qilmaydi: to'lov qatorlarini `PaymentsService.ensurePayments*`,
 * cheklarni `submitReceipt`, o'qituvchi ulushini `StaffSalariesService` yaratadi —
 * natija kabinetdagi hisob-kitob bilan bir xil bo'ladi. Skript faqat o'tgan sanalarni
 * (a'zolik oynalari, davomat, chek sanalari) to'g'ri qo'yib beradi.
 */
import 'reflect-metadata';
import * as path from 'path';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { dataSourceOptions } from '../../../db/data-source';

// Entity'lar odatda dist/ dan yuklanadi; skript src/ dan ishlagani uchun yo'lni almashtiramiz
// (aks holda TypeORM ikki xil class ko'radi). AppModule shundan KEYIN yuklanishi shart.
(dataSourceOptions as any).entities = [path.join(__dirname, '../../../src/**/*.entity.ts')];

import { parseWorkbook } from './parse';
import { buildModel, MGroup, Model, PENDING_JOIN } from './model';
import { printModelReport } from './report';
import { fillTeacherAttendance } from './staff-attendance';
import { inferDiscounts } from './infer-discounts';
import { settleSalaries } from './salaries';

const ORG_ID = Number(argValue('--org') ?? 4);
const CENTER_ID = Number(argValue('--center') ?? 7);
const ADMIN_LOGIN = argValue('--admin') ?? 'litech@talimplus.uz';

/** Oylik xarajatlar (foydalanuvchi bergan): ijara $ -> so'm (100$ = 1 200 000). */
const USD = 12_000;
const EXPENSES: { name: string; month: string; amount: number; description?: string }[] = [
  { name: 'Ijara', month: '2026-06', amount: 600 * USD, description: '600$ (1$ = 12 000 so‘m)' },
  { name: 'Ijara', month: '2026-07', amount: 600 * USD, description: '600$ (1$ = 12 000 so‘m)' },
  { name: 'Ijara', month: '2026-08', amount: 500 * USD, description: '500$ (1$ = 12 000 so‘m)' },
  { name: 'Ijara', month: '2026-09', amount: 500 * USD, description: '500$ (1$ = 12 000 so‘m)' },
  { name: 'Elektr energiyasi', month: '2026-06', amount: 1_224_000 },
  { name: 'Elektr energiyasi', month: '2026-07', amount: 1_374_000 },
  { name: 'Elektr energiyasi', month: '2026-08', amount: 1_191_000 },
  ...['2026-06', '2026-07', '2026-08', '2026-09'].map((month) => ({
    name: 'Mashina uchun gaz',
    month,
    amount: 1_000_000,
  })),
];

/** Statik oylikli xodimlar (o'qituvchilar faqat 50% ulush oladi). */
const STAFF = [
  { firstName: 'Qabulxona', lastName: 'Xodimi', role: 'reception', roleName: 'Qabulxona', salary: 1_500_000 },
  { firstName: 'Mobilograf', lastName: 'Xodimi', role: 'other', roleName: 'Boshqa', salary: 1_000_000 },
];
const TEACHER_COMMISSION = 50;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const log = (...a: unknown[]) => console.log('•', ...a);
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

async function main() {
  const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'new-data/LITECH 2026.xlsx';
  const model = buildModel(await parseWorkbook(file));
  printModelReport(model);
  if (!process.argv.includes('--apply')) {
    console.log('\nDry-run. Bazaga yozish uchun --apply qo\'shing.');
    return;
  }

  const { NestFactory } = await import('@nestjs/core');
  const { DataSource } = await import('typeorm');
  const { TelegramBotService } = await import('@/modules/telegram/telegram-bot.service');
  // Dev server bilan bir tokenni ikki joydan polling qilmaslik uchun botlar ishga tushmaydi
  TelegramBotService.prototype.onApplicationBootstrap = async () => undefined;
  const { AppModule } = await import('@/app.module');
  const { PaymentsService } = await import('@/modules/payments/payments.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const ds = app.get(DataSource);
    const ctx: Ctx = {
      ds,
      model,
      payments: app.get(PaymentsService),
      ids: { rooms: new Map(), subjects: new Map(), teachers: new Map(), groups: new Map(), students: new Map() },
    };
    await preflight(ctx);
    if (process.argv.includes('--reset')) await reset(ctx);
    await importReferenceData(ctx);
    await importGroups(ctx);
    await importStudents(ctx);
    await importAttendance(ctx);
    await importPayments(ctx);
    // Qoldig'i aynan 10% / 20 000 bo'lgan oylar — qarz emas, chegirma (egasi tasdiqlagan qoida)
    const disc = await inferDiscounts(app, { centerId: CENTER_ID, apply: true });
    log(`Chegirmalar aniqlandi: ${disc.candidates.length} oy (qarz ${fmt(disc.before)} → ${fmt(disc.after)})`);
    await finalizeStudents(ctx);
    // Oylik (ish oyi): iyun/iyul — markaz bergan summa, avgust — to'lanmagan (salaries.ts)
    const sal = await settleSalaries(app, { orgId: ORG_ID, adminId: ctx.admin!.id, apply: true });
    log(`Oyliklar: ${sal.map((m) => `${m.month} ${m.paid} to'langan / ${m.unpaid} to'lanmagan`).join(', ')}`);
    // O'qituvchilar "Keldim" yozuvlari — darsi bo'lgan har kun, bugungacha (egasi tasdiqlagan)
    const { dayjs } = await import('@/shared/utils/dayjs');
    const att = await fillTeacherAttendance(app, {
      orgId: ORG_ID,
      adminId: ctx.admin!.id,
      to: dayjs().tz('Asia/Tashkent').format('YYYY-MM-DD'),
    });
    log(`O'qituvchilar davomati: ${att.days} kun (${att.skipped} tasi hali boshlanmagan)`);
    await importExpenses(ctx);
    await importLeads(ctx);
    await verify(ctx);
  } finally {
    await app.close();
  }
}

interface Ctx {
  ds: import('typeorm').DataSource;
  model: Model;
  payments: import('@/modules/payments/payments.service').PaymentsService;
  admin?: { id: number };
  password?: string;
  ids: {
    rooms: Map<string, number>;
    subjects: Map<string, number>;
    teachers: Map<string, number>;
    groups: Map<number, number>; // model idx -> db id
    students: Map<number, number>;
  };
}

async function one<T = any>(ctx: Ctx, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await ctx.ds.query(sql, params);
  return rows[0];
}

async function preflight(ctx: Ctx) {
  const center = await one(ctx, `SELECT id FROM centers WHERE id = $1 AND "organizationId" = $2`, [CENTER_ID, ORG_ID]);
  if (!center) throw new Error(`Filial ${CENTER_ID} tashkilot ${ORG_ID} ga tegishli emas`);
  ctx.admin = await one(ctx, `SELECT id FROM users WHERE login = $1 AND "organizationId" = $2`, [ADMIN_LOGIN, ORG_ID]);
  if (!ctx.admin) throw new Error(`Admin ${ADMIN_LOGIN} topilmadi`);
  const existing = await one(ctx, `SELECT count(*)::int AS n FROM students WHERE "centerId" = $1`, [CENTER_ID]);
  if (existing.n > 0 && !process.argv.includes('--reset')) {
    throw new Error(`Filialda allaqachon ${existing.n} ta o'quvchi bor. Qayta yuklash uchun --reset qo'shing.`);
  }
}

async function reset(ctx: Ctx) {
  const C = [CENTER_ID];
  const U = [ORG_ID, ctx.admin!.id];
  const groups = `SELECT id FROM groups WHERE "centerId" = $1`;
  const students = `SELECT id FROM students WHERE "centerId" = $1`;
  const users = `SELECT id FROM users WHERE "organizationId" = $1 AND id <> $2`;
  const salaries = `SELECT id FROM staff_salaries WHERE "userId" IN (${users})`;
  const steps: [string, unknown[]][] = [
    [`DELETE FROM payment_receipts WHERE "paymentId" IN (SELECT id FROM payments WHERE "studentId" IN (${students}))`, C],
    [`DELETE FROM payments WHERE "studentId" IN (${students})`, C],
    [`DELETE FROM attendance WHERE "groupId" IN (${groups})`, C],
    [`DELETE FROM student_group_enrollments WHERE "groupId" IN (${groups})`, C],
    [`DELETE FROM student_discount_periods WHERE "studentId" IN (${students})`, C],
    [`DELETE FROM students_groups_groups WHERE "groupsId" IN (${groups})`, C],
    [`DELETE FROM leads WHERE "centerId" = $1`, C],
    [`DELETE FROM students WHERE "centerId" = $1`, C],
    [`DELETE FROM group_fee_periods WHERE "groupId" IN (${groups})`, C],
    [`DELETE FROM group_schedule WHERE "groupId" IN (${groups})`, C],
    [`DELETE FROM groups WHERE "centerId" = $1`, C],
    [`DELETE FROM expenses WHERE "centerId" = $1`, C],
    [`DELETE FROM teacher_commission_carryovers WHERE "teacherId" IN (${users})`, U],
    [`DELETE FROM teacher_monthly_earnings WHERE "teacherId" IN (${users})`, U],
    [`DELETE FROM staff_salary_payments WHERE "staffSalaryId" IN (${salaries})`, U],
    [`DELETE FROM staff_salary_deductions WHERE "staffSalaryId" IN (${salaries})`, U],
    [`DELETE FROM staff_deductions WHERE "userId" IN (${users})`, U],
    [`DELETE FROM staff_salaries WHERE "userId" IN (${users})`, U],
    [`DELETE FROM staff_attendances WHERE "userId" IN (${users})`, U],
    [`DELETE FROM users WHERE "organizationId" = $1 AND id <> $2`, U],
    [`DELETE FROM rooms WHERE "centerId" = $1`, C],
    [`DELETE FROM subjects WHERE "centerId" = $1`, C],
  ];
  await ctx.ds.transaction(async (m) => {
    for (const [sql, params] of steps) await m.query(sql, params);
  });
  log('Filial tozalandi');
}

async function importReferenceData(ctx: Ctx) {
  const { model, ids } = ctx;
  await ctx.ds.query(`UPDATE centers SET "isDefault" = true WHERE id = $1`, [CENTER_ID]);
  // Kabinet (masalan Ish haqi oylari) filial ochilgan sanadan oldingi oylarni ko'rsatmaydi —
  // tarix iyundan boshlangani uchun filial va tashkilot ham iyundan "ochilgan" bo'ladi.
  await ctx.ds.query(`UPDATE centers SET "createdAt" = '2026-06-01' WHERE id = $1 AND "createdAt" > '2026-06-01'`, [CENTER_ID]);
  await ctx.ds.query(`UPDATE organizations SET "createdAt" = '2026-06-01' WHERE id = $1 AND "createdAt" > '2026-06-01'`, [ORG_ID]);

  const rooms = Array.from(new Set(model.groups.map((g) => g.room).filter((r): r is string => !!r))).sort();
  for (const name of rooms) {
    const r = await one(ctx, `INSERT INTO rooms (name, "centerId", "createdAt") VALUES ($1, $2, '2026-06-01') RETURNING id`, [name, CENTER_ID]);
    ids.rooms.set(name, r.id);
  }
  const subjects = Array.from(new Set(model.groups.map((g) => g.subject))).sort();
  for (const name of subjects) {
    const r = await one(ctx, `INSERT INTO subjects (name, "centerId", "createdAt") VALUES ($1, $2, '2026-06-01') RETURNING id`, [name, CENTER_ID]);
    ids.subjects.set(name, r.id);
  }

  // Barcha yangi xodimlar uchun bitta boshlang'ich parol — admin keyin almashtiradi
  ctx.password = `Litech-${crypto.randomBytes(3).toString('hex')}`;
  const hash = await bcrypt.hash(ctx.password, 10);
  const roleId = async (name: string) =>
    (await one(ctx, `SELECT id FROM roles WHERE "organizationId" = $1 AND name = $2`, [ORG_ID, name]))?.id ?? null;
  const teacherRoleId = await roleId('O‘qituvchi');
  let seq = 1;
  const phone = () => `+998000${String(ORG_ID).padStart(2, '0')}${String(seq++).padStart(4, '0')}`;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

  // users.createdAt = 2026-06-01: oylik qatori faqat iyul to'lov oyidan (iyun ishi) boshlanadi
  for (const t of model.teachers) {
    const r = await one(
      ctx,
      `INSERT INTO users ("firstName", "lastName", login, phone, password, role, salary, "commissionPercentage",
         "createdAt", "centerId", "organizationId", "userRoleId")
       VALUES ($1, $2, $3, $4, $5, 'teacher', 0, $6, '2026-06-01', $7, $8, $9) RETURNING id`,
      [t.firstName, t.lastName, `${slug(t.firstName)}.${ORG_ID}@litech.uz`, phone(), hash, TEACHER_COMMISSION, CENTER_ID, ORG_ID, teacherRoleId],
    );
    ctx.ids.teachers.set(t.key, r.id);
  }
  for (const s of STAFF) {
    await ctx.ds.query(
      `INSERT INTO users ("firstName", "lastName", login, phone, password, role, salary, "createdAt",
         "centerId", "organizationId", "userRoleId")
       VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-06-01', $8, $9, $10)`,
      [s.firstName, s.lastName, `${slug(s.firstName)}.${ORG_ID}@litech.uz`, phone(), hash, s.role, s.salary, CENTER_ID, ORG_ID, await roleId(s.roleName)],
    );
  }
  log(`Xonalar: ${rooms.length}, fanlar: ${subjects.length}, o'qituvchilar: ${model.teachers.length}, xodimlar: ${STAFF.length}`);
}

async function importGroups(ctx: Ctx) {
  for (const g of ctx.model.groups) {
    const months = Object.keys(g.feeByMonth).sort();
    const currentFee = g.feeByMonth[months[months.length - 1]];
    const r = await one(
      ctx,
      `INSERT INTO groups (name, "createdAt", "subjectId", "centerId", "teacherId", "monthlyFee", "roomId", timezone,
         "startDate", "endDate", status, "startedAt", "lessonDurationMinutes")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Asia/Tashkent', $8, $9, $10, $11, $12) RETURNING id`,
      [
        g.name,
        g.startDate,
        ctx.ids.subjects.get(g.subject),
        CENTER_ID,
        ctx.ids.teachers.get(g.teacherKey),
        currentFee,
        g.room ? ctx.ids.rooms.get(g.room) : null,
        g.startDate,
        g.endDate,
        g.status,
        g.startDate,
        g.lessonMinutes,
      ],
    );
    ctx.ids.groups.set(g.idx, r.id);
    for (const day of g.days) {
      await ctx.ds.query(`INSERT INTO group_schedule (day, "startTime", "groupId") VALUES ($1, $2, $3)`, [day, g.startTime, r.id]);
    }
    // Narx tarixi: faqat o'zgargan oylar (group_fee_periods — oyga bog'langan narx)
    let prev: number | null = null;
    for (const m of months) {
      if (g.feeByMonth[m] === prev) continue;
      prev = g.feeByMonth[m];
      await ctx.ds.query(
        `INSERT INTO group_fee_periods ("groupId", "fromMonth", "monthlyFee", "createdAt") VALUES ($1, $2::date, $3, $2::date)`,
        [r.id, `${m}-01`, prev],
      );
    }
  }
  log(`Guruhlar: ${ctx.model.groups.length}`);
}

async function importStudents(ctx: Ctx) {
  const { model } = ctx;
  const withEnrollments = new Set(model.enrollments.map((e) => e.studentIdx));
  for (const s of model.students) {
    if (!withEnrollments.has(s.idx)) continue;
    // To'lov qatorlari faqat ACTIVE o'quvchilarga yaratiladi — yakuniy holat finalizeStudents'da qo'yiladi
    const status = s.status === 'new' ? 'new' : 'ACTIVE';
    const created = s.activatedAt ?? '2026-09-01';
    const r = await one(
      ctx,
      `INSERT INTO students ("firstName", "lastName", phone, "secondPhone", status, "createdAt", "centerId",
         "activatedAt", "stoppedAt", comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [s.firstName, s.lastName, s.phone, s.secondPhone, status, created, CENTER_ID, s.activatedAt, s.stoppedAt, s.notes.join('\n') || null],
    );
    ctx.ids.students.set(s.idx, r.id);
  }

  const firstJoin = new Map<string, string>();
  for (const e of model.enrollments) {
    const sid = ctx.ids.students.get(e.studentIdx)!;
    const gid = ctx.ids.groups.get(e.groupIdx)!;
    await ctx.ds.query(
      `INSERT INTO student_group_enrollments ("studentId", "groupId", "joinedAt", "leftAt", "leftReason", "createdAt")
       VALUES ($1, $2, $3::date, $4, $5, $3::date)`,
      [sid, gid, e.joinedAt, e.leftAt, e.leftAt ? 'Sheet: keyingi oy ro‘yxatida yo‘q' : null],
    );
    const key = `${sid}:${gid}`;
    if (!firstJoin.has(key) || e.joinedAt < firstJoin.get(key)!) firstJoin.set(key, e.joinedAt);
  }
  // Billing vaqtida o'quvchi o'qigan barcha guruhlarga bog'langan bo'lishi kerak (ensurePayments junction'ni o'qiydi)
  for (const [key, joinedAt] of firstJoin) {
    const [sid, gid] = key.split(':').map(Number);
    await ctx.ds.query(
      `INSERT INTO students_groups_groups ("studentsId", "groupsId", "joinedAt") VALUES ($1, $2, $3)`,
      [sid, gid, joinedAt],
    );
  }
  log(`O'quvchilar: ${ctx.ids.students.size}, a'zolik oynalari: ${model.enrollments.length}`);
}

async function importAttendance(ctx: Ctx) {
  const STATUS: Record<number, [string, string | null]> = {
    1: ['present', null],
    0: ['absent', null],
    2: ['excused', 'Sababli'],
    5: ['present', 'Bayram kuni (to‘lovga kiradi)'],
  };
  const rows = ctx.model.attendance.map((a) => {
    const g = ctx.model.groups[a.groupIdx];
    const [status, comment] = STATUS[a.mark];
    return [a.date, ctx.ids.students.get(a.studentIdx), ctx.ids.groups.get(a.groupIdx), status, comment, ctx.ids.teachers.get(g.teacherKey)];
  });
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk
      .map((_, k) => `($${k * 6 + 1}, $${k * 6 + 2}, $${k * 6 + 3}, $${k * 6 + 4}, $${k * 6 + 5}, $${k * 6 + 6}, ($${k * 6 + 1})::date + time '12:00', ($${k * 6 + 1})::date + time '12:00')`)
      .join(',');
    await ctx.ds.query(
      `INSERT INTO attendance ("lessonDate", "studentId", "groupId", status, comment, "submittedById", "submittedAt", "updatedAt")
       VALUES ${values} ON CONFLICT DO NOTHING`,
      chunk.flat(),
    );
  }
  log(`Davomat: ${rows.length}`);
}

async function importPayments(ctx: Ctx) {
  // To'lov qatorlari — tizimning o'z hisobi bilan (proratsiya a'zolik oynasidan)
  await ctx.payments.ensurePaymentsForOrganization(ORG_ID, { maxMonthsBack: 4, centerId: CENTER_ID });
  await ctx.ds.query(
    `UPDATE payments SET "createdAt" = "forMonth" WHERE "studentId" IN (SELECT id FROM students WHERE "centerId" = $1)`,
    [CENTER_ID],
  );
  const created = await one(ctx, `SELECT count(*)::int AS n FROM payments p JOIN students s ON s.id = p."studentId" WHERE s."centerId" = $1`, [CENTER_ID]);
  log(`To'lov qatorlari yaratildi: ${created.n}`);

  const find = (sid: number, gid: number, month: string) =>
    one(ctx, `SELECT id, "amountDue"::float AS due FROM payments WHERE "studentId" = $1 AND "groupId" = $2 AND TO_CHAR("forMonth", 'YYYY-MM') = $3`, [sid, gid, month]);

  const issues: string[] = [];
  let raised = 0;
  let freeRows = 0;
  const adminUser = { userId: ctx.admin!.id, email: ADMIN_LOGIN, role: 'admin', organizationId: ORG_ID, centerId: CENTER_ID } as any;
  const toPay = [...ctx.model.payments].sort((a, b) => a.paidAt.localeCompare(b.paidAt) || a.studentIdx - b.studentIdx);

  for (const p of toPay) {
    const sid = ctx.ids.students.get(p.studentIdx)!;
    const gid = ctx.ids.groups.get(p.groupIdx)!;
    const student = ctx.model.students[p.studentIdx];
    const label = `${student.lastName} ${student.firstName} / ${ctx.model.groups[p.groupIdx].name} / ${p.month}`;
    let row = await find(sid, gid, p.month);
    if (!row) {
      if (!p.paid) continue;
      // Hisobda dars chiqmagan, lekin pul tushgan — qatorni sheet summasi bilan yaratamiz
      row = await one(
        ctx,
        `INSERT INTO payments ("studentId", "groupId", "forMonth", "amountDue", "amountPaid", status, "dueDate", "hardDueDate", "createdAt")
         VALUES ($1, $2, $3::date, $4, 0, 'unpaid', $5, $6, $3::date) RETURNING id, "amountDue"::float AS due`,
        [sid, gid, `${p.month}-01`, p.paid, `${p.month}-10`, `${p.month}-15`],
      );
      issues.push(`Qator yo'q edi, sheet summasi bilan yaratildi: ${label} (${fmt(p.paid)})`);
    }

    if (p.free) {
      await ctx.ds.query(
        `UPDATE payments SET "manualExcludedAmount" = "amountDue", "manualExcludedReason" = $2, "amountDue" = 0, status = 'paid' WHERE id = $1`,
        [row.id, `Tekin o‘qigan (sheet: ${p.free})`],
      );
      freeRows++;
      continue;
    }
    if (!p.paid) continue;

    if (p.paid > row.due + 0.5) {
      // Sheet — pul bo'yicha haqiqat: hisobdan ko'p olingan bo'lsa, qarzni shunga tenglaymiz
      await ctx.ds.query(`UPDATE payments SET "amountDue" = $2 WHERE id = $1`, [row.id, p.paid]);
      raised++;
      issues.push(`Hisob ${fmt(row.due)} < to'langan ${fmt(p.paid)}: ${label}`);
    }
    try {
      const { receipt } = await ctx.payments.submitReceipt(
        row.id,
        p.paid,
        adminUser,
        `Google Sheet'dan ko‘chirildi${p.receipt ? `. Kvitansiya: ${p.receipt}` : ''}`,
        'cash' as any,
        p.paidAt,
      );
      await ctx.ds.query(
        `UPDATE payment_receipts SET "receivedAt" = $2::date + time '12:00', "confirmedAt" = $2::date + time '12:00',
           "createdAt" = $2::date + time '12:00' WHERE id = $1`,
        [receipt.id, p.paidAt],
      );
    } catch (e) {
      issues.push(`Chek yozilmadi: ${label}: ${(e as Error).message}`);
    }
  }
  log(`Cheklar: ${toPay.filter((p) => p.paid > 0).length}, tekin oylar: ${freeRows}, hisobi oshirilgan: ${raised}`);
  if (issues.length) {
    console.log(`  Diqqat (${issues.length}):`);
    issues.forEach((i) => console.log('   - ' + i));
  }
}

async function finalizeStudents(ctx: Ctx) {
  for (const s of ctx.model.students) {
    const sid = ctx.ids.students.get(s.idx);
    if (!sid) continue;
    await ctx.ds.query(
      `UPDATE students SET status = $2, "stoppedAt" = $3, "returnLikelihood" = $4 WHERE id = $1`,
      [sid, s.status, s.stoppedAt, s.status === 'stopped' ? 'maybe' : null],
    );
  }
  // Junction — "hozir qaysi guruhda". Guruh davom etayotgan bo'lsa-yu, o'quvchi chiqib ketgan bo'lsa — uzamiz.
  // Tugagan guruhlar bog'lanishi saqlanadi (o'quvchi guruh bilan birga tugatgan).
  for (const e of ctx.model.enrollments) {
    if (!e.leftAt) continue;
    const sid = ctx.ids.students.get(e.studentIdx)!;
    const gid = ctx.ids.groups.get(e.groupIdx)!;
    const stillOpen = ctx.model.enrollments.some(
      (o) => o.studentIdx === e.studentIdx && o.groupIdx === e.groupIdx && !o.leftAt,
    );
    if (!stillOpen) {
      await ctx.ds.query(`DELETE FROM students_groups_groups WHERE "studentsId" = $1 AND "groupsId" = $2`, [sid, gid]);
    }
  }
  const pending = ctx.model.enrollments.filter((e) => e.pending).length;
  log(`O'quvchi holatlari qo'yildi (kutilayotgan a'zolik ${PENDING_JOIN} dan: ${pending})`);
}

async function importExpenses(ctx: Ctx) {
  for (const e of EXPENSES) {
    await ctx.ds.query(
      `INSERT INTO expenses (name, amount, "forMonth", "createdAt", "centerId", description) VALUES ($1, $2, $3::date, $3::date, $4, $5)`,
      [e.name, e.amount, `${e.month}-01`, CENTER_ID, e.description ?? null],
    );
  }
  log(`Xarajatlar: ${EXPENSES.length}`);
}

function leadStatus(raw: string | null): string {
  const s = (raw ?? '').toLowerCase();
  if (s.includes("o'qimoqda") || s.includes('oqimoqda')) return 'converted';
  if (/istamadi|boshqa joyda|oqitolmaymiz|bog'lanib|boglanib/.test(s)) return 'discarded';
  if (/kutmoqda|o'ylab|kelajakda/.test(s)) return 'keyinroq';
  return 'new';
}

async function importLeads(ctx: Ctx) {
  // Bitta odam LIDLAR'da ham, Qabulxona'da ham bo'lishi mumkin — (tashkilot, telefon) unique,
  // shuning uchun telefon bo'yicha birlashtiramiz: holat eng oxirgi yozuvdan, izohlar qo'shiladi.
  const byPhone = new Map<string, Model['leads']>();
  let noPhone = 0;
  for (const l of ctx.model.leads) {
    if (!l.phones[0]) {
      noPhone++;
      continue;
    }
    byPhone.set(l.phones[0], [...(byPhone.get(l.phones[0]) ?? []), l]);
  }
  const dateOf = (l: Model['leads'][number]) =>
    l.registeredAt && /^\d{4}-\d{2}-\d{2}$/.test(l.registeredAt) ? l.registeredAt : '2026-09-01';

  for (const [phone, group] of byPhone) {
    const sorted = [...group].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    const latest = sorted[sorted.length - 1];
    const named = [...sorted].reverse().find((l) => l.name) ?? latest;
    const [last, ...rest] = (named.name ?? '').trim().split(/\s+/);
    const matched = sorted.map((l) => l.matchedStudentIdx).find((x) => x != null);
    const studentId = matched != null ? ctx.ids.students.get(matched) ?? null : null;
    const comment = sorted
      .map((l) =>
        [
          l.note,
          l.school && `Maktab: ${l.school}`,
          l.course && `Kurs: ${l.course}`,
          l.days && `Kunlar: ${l.days}`,
          l.time && `Vaqt: ${l.time}`,
          l.status && `Sheet holati: ${l.status}`,
          l.birth && `Tug'ilgan yili: ${l.birth}`,
          `Manba: ${l.source}, ${dateOf(l)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n---\n');
    const second = sorted.flatMap((l) => l.phones).find((p) => p !== phone);
    await ctx.ds.query(
      `INSERT INTO leads ("firstName", "lastName", phone, "secondPhone", comment, "heardAboutUs", status, "studentId",
         "centerId", "organizationId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::date)`,
      [
        rest.length ? rest.join(' ') : last || null,
        rest.length ? last : null,
        `+998${phone}`,
        second ? `+998${second}` : null,
        comment || null,
        sorted.map((l) => l.heardFrom).find(Boolean) ?? null,
        leadStatus(latest.status),
        studentId,
        CENTER_ID,
        ORG_ID,
        dateOf(sorted[0]),
        dateOf(latest),
      ],
    );
  }
  log(`Lidlar: ${byPhone.size} (sheet'da ${ctx.model.leads.length} qator, telefonsiz o'tkazildi: ${noPhone})`);
}

async function verify(ctx: Ctx) {
  console.log('\n=== TEKSHIRUV (baza vs sheet) ===');
  const received = await ctx.ds.query(
    `SELECT TO_CHAR(p."forMonth", 'YYYY-MM') AS m, SUM(r.amount)::float AS paid
       FROM payment_receipts r JOIN payments p ON p.id = r."paymentId" JOIN students s ON s.id = p."studentId"
      WHERE s."centerId" = $1 AND r.status = 'confirmed' GROUP BY 1 ORDER BY 1`,
    [CENTER_ID],
  );
  const debts = await ctx.ds.query(
    `SELECT TO_CHAR(p."forMonth", 'YYYY-MM') AS m, SUM(p."amountDue" - p."amountPaid")::float AS debt,
            SUM(p."amountDue")::float AS due, count(*) FILTER (WHERE p.status <> 'paid')::int AS open
       FROM payments p JOIN students s ON s.id = p."studentId"
      WHERE s."centerId" = $1 GROUP BY 1 ORDER BY 1`,
    [CENTER_ID],
  );
  for (const d of debts) {
    const sheet = ctx.model.payments.filter((p) => p.month === d.m).reduce((a, p) => a + p.paid, 0);
    const got = received.find((r) => r.m === d.m)?.paid ?? 0;
    console.log(
      `${d.m}: sheet ${fmt(sheet)} | bazada tushum ${fmt(got)} ${Math.abs(sheet - got) < 1 ? '✓' : '✗'} | ` +
        `hisoblangan ${fmt(d.due)} | qarz ${fmt(d.debt)} (${d.open} ta ochiq)`,
    );
  }

  console.log("\nO'qituvchi ulushi (sheet Mentor vs tizim komissiyasi, to'lov oyi = keyingi oy):");
  const earnings = await ctx.ds.query(
    `SELECT u."firstName" AS name, TO_CHAR(e."forMonth", 'YYYY-MM') AS pay, e."commissionAmount"::float AS c
       FROM teacher_monthly_earnings e JOIN users u ON u.id = e."teacherId" WHERE u."organizationId" = $1 ORDER BY 1, 2`,
    [ORG_ID],
  );
  const byTeacher = new Map<string, MGroup['teacherKey']>();
  ctx.model.groups.forEach((g) => byTeacher.set(g.sheet, g.teacherKey));
  for (const e of earnings) {
    const key = ctx.model.teachers.find((t) => t.firstName === e.name)?.key;
    const earnMonth = prevMonth(e.pay);
    const mentor = ctx.model.footers
      .filter((f) => byTeacher.get(f.sheet) === key && f.month === earnMonth)
      .reduce((a, f) => a + (f.mentor ?? 0) * 1000, 0);
    console.log(`  ${e.name.padEnd(11)} ${earnMonth}: sheet ${fmt(mentor).padStart(10)} | tizim ${fmt(e.c).padStart(10)}`);
  }
  console.log(`\nYangi xodimlar uchun boshlang'ich parol: ${ctx.password}`);
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
