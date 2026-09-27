/**
 * Sheet'da chegirma alohida yozilmagan — o'quvchi shunchaki kamroq to'lagan.
 * Markaz egasi qoidasi: to'lanmay qolgan qoldiq o'sha oy hisobining aynan 10% i
 * yoki 20 000 so'm bo'lsa — bu qarz emas, CHEGIRMA (ikki fanda o'qiganlar va
 * boshqa sabab bilan berilganlar). Shunday qatorlarga o'sha oy va o'sha guruh
 * uchun chegirma davri yoziladi, keyin to'lov tizimning o'z hisobi bilan qayta
 * hisoblanadi (summadagi chegirma faqat to'liq oyga — `computeAmountDue`).
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/legacy-import/litech/infer-discounts.ts --center 7 [--apply]
 */
import 'reflect-metadata';
import * as path from 'path';
import { dataSourceOptions } from '../../../db/data-source';

(dataSourceOptions as any).entities = [path.join(__dirname, '../../../src/**/*.entity.ts')];

import type { INestApplicationContext } from '@nestjs/common';

export const FIXED_DISCOUNT = 20_000;
export const PERCENT_DISCOUNT = 10;
/** Sheet summalari minggacha yaxlitlangan — shuning uchun tolerantlik. */
const FIXED_TOLERANCE = 500;
const PERCENT_TOLERANCE = 1_000;

interface Candidate {
  paymentId: number;
  studentId: number;
  groupId: number;
  month: string; // YYYY-MM
  due: number;
  paid: number;
  kind: 'amount' | 'percent';
  groupsThatMonth: number;
  label: string;
}

export async function inferDiscounts(
  app: INestApplicationContext,
  opts: { centerId: number; apply: boolean },
): Promise<{ candidates: Candidate[]; before: number; after: number }> {
  const { DataSource } = await import('typeorm');
  const { PaymentsService } = await import('@/modules/payments/payments.service');
  const ds = app.get(DataSource);

  const debt = async () =>
    Number(
      (
        await ds.query(
          `SELECT COALESCE(SUM(p."amountDue" - p."amountPaid"), 0) AS d FROM payments p
             JOIN students s ON s.id = p."studentId" WHERE s."centerId" = $1 AND p.status <> 'paid'`,
          [opts.centerId],
        )
      )[0].d,
    );

  const rows: any[] = await ds.query(
    `SELECT p.id, p."studentId", p."groupId", TO_CHAR(p."forMonth", 'YYYY-MM') AS month,
            p."amountDue"::float AS due, p."amountPaid"::float AS paid,
            s."lastName" || ' ' || s."firstName" || ' / ' || g.name AS label,
            (SELECT count(*) FROM payments o WHERE o."studentId" = p."studentId"
               AND o."forMonth" = p."forMonth")::int AS "groupsThatMonth"
       FROM payments p
       JOIN students s ON s.id = p."studentId"
       JOIN groups g ON g.id = p."groupId"
      WHERE s."centerId" = $1 AND p.status = 'partial' AND p."amountPaid" > 0
        -- Oy o'rtasida qo'shilgan/chiqqan oyga chegirma berilmaydi (keyingi oydan)
        AND p."lessonsBillable" >= p."lessonsPlanned"
      ORDER BY month, label`,
    [opts.centerId],
  );

  const candidates: Candidate[] = [];
  for (const r of rows) {
    const rest = r.due - r.paid;
    let kind: Candidate['kind'] | null = null;
    if (Math.abs(rest - FIXED_DISCOUNT) <= FIXED_TOLERANCE) kind = 'amount';
    else if (Math.abs(rest - (r.due * PERCENT_DISCOUNT) / 100) <= PERCENT_TOLERANCE) kind = 'percent';
    if (!kind) continue;
    candidates.push({
      paymentId: r.id,
      studentId: r.studentId,
      groupId: r.groupId,
      month: r.month,
      due: r.due,
      paid: r.paid,
      kind,
      groupsThatMonth: r.groupsThatMonth,
      label: r.label,
    });
  }

  const before = await debt();
  if (!opts.apply) return { candidates, before, after: before };

  const nextMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  };
  for (const c of candidates) {
    const reason =
      (c.groupsThatMonth > 1 ? 'Ikki fanda o‘qigani uchun chegirma' : 'Chegirma') +
      ' (Google Sheet: to‘lanmay qolgan qoldiqdan aniqlandi)';
    await ds.query(
      `INSERT INTO student_discount_periods ("studentId", "groupId", "fromMonth", "toMonth", percent, amount, reason, "createdAt")
       VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $3::date)`,
      [
        c.studentId,
        c.groupId,
        `${c.month}-01`,
        nextMonth(c.month),
        c.kind === 'percent' ? PERCENT_DISCOUNT : 0,
        c.kind === 'amount' ? FIXED_DISCOUNT : 0,
        reason,
      ],
    );
  }
  // Qayta hisob — tizimning o'z mantig'i bilan (faqat PAID bo'lmagan qatorlar)
  const payments = app.get(PaymentsService);
  for (const studentId of new Set(candidates.map((c) => c.studentId))) {
    await payments.recalculateOpenPaymentsForStudent(studentId, { maxMonthsBack: 4 });
  }
  return { candidates, before, after: await debt() };
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (require.main === module) {
  (async () => {
    const centerId = Number(argValue('--center') ?? 7);
    const apply = process.argv.includes('--apply');
    const { NestFactory } = await import('@nestjs/core');
    const { TelegramBotService } = await import('@/modules/telegram/telegram-bot.service');
    TelegramBotService.prototype.onApplicationBootstrap = async () => undefined;
    const { AppModule } = await import('@/app.module');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    try {
      const r = await inferDiscounts(app, { centerId, apply });
      for (const c of r.candidates) {
        const off = c.kind === 'amount' ? '20 000' : '10%';
        console.log(`${c.month} ${c.label.padEnd(48)} hisob ${Math.round(c.due)} to'langan ${c.paid} → ${off}${c.groupsThatMonth > 1 ? ' (2 fan)' : ''}`);
      }
      const byKind = (k: string) => r.candidates.filter((c) => c.kind === k).length;
      console.log(`\nJami: ${r.candidates.length} (20 000: ${byKind('amount')}, 10%: ${byKind('percent')})`);
      console.log(`Ochiq qarz: ${Math.round(r.before).toLocaleString('ru-RU')} → ${Math.round(r.after).toLocaleString('ru-RU')}${apply ? '' : '  (dry-run, --apply bilan yoziladi)'}`);
    } finally {
      await app.close();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
