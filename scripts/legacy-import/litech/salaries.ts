/**
 * Xodimlar oyligi (o'tgan davr). `staff_salaries.forMonth` — ISH oyi; pul keyingi oyning
 * 5-sanasida berilgan deb yoziladi.
 *
 * - O'qituvchilar: haqiqatda berilgan summa markazning alohida "Oqituvchilar Oylik-2026.xlsx"
 *   faylida (parolli) — har bir o'qituvchi varag'idagi oy blokining "Mentor" qatori.
 *   Tizim hisoblagan komissiya undan farq qiladi (fayl — markaz o'zi bergan pul), shuning
 *   uchun oy qatorining `baseSalary` si fayldagi summaga qo'yiladi.
 *   Faylda yo'q o'qituvchi (Shaxriyor) — tizim hisobi qoladi.
 * - Avgust ishi markazda hali yopilmagan: o'qituvchilarga to'lanmagan
 *   qoladi, summani tizim hisoblaydi — rahbar kabinetdan o'zi to'g'rilaydi.
 * - Qabulxona/mobilograf — statik maosh, iyun–avgust to'langan.
 * - Joriy oy (sentabr) bu yerda tegilmaydi — tizim o'zi ochadi va to'lanmagan turadi.
 *
 * Takroriy ishga tushirish xavfsiz (to'lovlar qayta yoziladi):
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/legacy-import/litech/salaries.ts --org 4 --admin litech@talimplus.uz [--apply]
 */
import 'reflect-metadata';
import * as path from 'path';
import { dataSourceOptions } from '../../../db/data-source';

(dataSourceOptions as any).entities = [path.join(__dirname, '../../../src/**/*.entity.ts')];

import type { INestApplicationContext } from '@nestjs/common';

export const SALARY_MONTHS = ['2026-06', '2026-07', '2026-08'];

/** Ish oyi → o'qituvchi (ism) → berilgan summa (fayldagi iyun va iyul bloklari). */
export const TEACHER_PAYOUTS: Record<string, Record<string, number>> = {
  '2026-06': {
    Lazizbek: 0,
    Feruza: 637_000,
    Muslimaxon: 592_500,
    Nafisa: 6_961_500,
    Gulchexra: 3_493_000,
    Umarjon: 1_400_000,
    Durbek: 686_500,
    Sevara: 1_324_000,
  },
  '2026-07': {
    Lazizbek: 2_210_000,
    Feruza: 1_425_000,
    Muslimaxon: 1_110_000,
    Nafisa: 6_029_500,
    Gulchexra: 2_929_000,
    Umarjon: 770_000,
    Durbek: 753_500,
    Sevara: 1_440_500,
  },
};

/** O'qituvchilarga hali to'lanmagan ish oylari (markazda yopilmagan). */
export const UNSETTLED_TEACHER_MONTHS = ['2026-08'];

const COMMENT = 'Markaz hisobi bo‘yicha (o‘tgan davr)';

interface SalaryRow {
  id: number;
  name: string;
  role: string;
  base: number;
  deduction: number;
  status: string;
}

export interface SettleResult {
  month: string;
  paid: number;
  unpaid: number;
  total: number;
}

export async function settleSalaries(
  app: INestApplicationContext,
  opts: { orgId: number; adminId: number; apply: boolean },
): Promise<SettleResult[]> {
  const { DataSource } = await import('typeorm');
  const { StaffSalariesService } = await import('@/modules/staff-salaries/staff-salaries.service');
  const ds = app.get(DataSource);
  const salaries = app.get(StaffSalariesService);
  const reqUser = { userId: opts.adminId, role: 'admin', organizationId: opts.orgId } as any;

  const load = (month: string): Promise<SalaryRow[]> =>
    ds.query(
      `SELECT s.id, u."firstName" AS name, u.role, s."baseSalary"::float AS base,
              s."deductionAmount"::float AS deduction, s.status
         FROM staff_salaries s JOIN users u ON u.id = s."userId"
        WHERE u."organizationId" = $1 AND TO_CHAR(s."forMonth", 'YYYY-MM') = $2`,
      [opts.orgId, month],
    );
  // Oldingi yurishdagi to'lovni olib tashlab, qatorni "to'lanmagan" holatga qaytaradi
  const reset = async (id: number) => {
    await ds.query(`DELETE FROM staff_salary_payments WHERE "staffSalaryId" = $1`, [id]);
    await ds.query(`UPDATE staff_salaries SET "paidAmount" = 0, status = 'unpaid', "paidAt" = NULL WHERE id = $1`, [id]);
  };
  // Oylik keyingi oyning 5-sanasida berilgan
  const backdate = async (id: number, month: string) => {
    const paidOn = `${month}-05`;
    await ds.query(`UPDATE staff_salaries SET "paidAt" = ($2::date + interval '1 month') + time '12:00' WHERE id = $1`, [
      id,
      paidOn,
    ]);
    await ds.query(
      `UPDATE staff_salary_payments SET "paidAt" = ($2::date + interval '1 month') + time '12:00' WHERE "staffSalaryId" = $1`,
      [id, paidOn],
    );
  };

  const out: SettleResult[] = [];
  for (const month of SALARY_MONTHS) {
    if (opts.apply) await salaries.ensureSalariesForMonth(opts.orgId, month);
    for (const r of await load(month)) {
      if (!opts.apply) continue;
      const teacher = r.role === 'teacher';
      if (teacher && UNSETTLED_TEACHER_MONTHS.includes(month)) {
        if (r.status !== 'unpaid') await reset(r.id);
        continue;
      }
      const target = teacher ? TEACHER_PAYOUTS[month]?.[r.name] : undefined;
      if (target !== undefined && r.base !== target) {
        await reset(r.id);
        await ds.query(`UPDATE staff_salaries SET "baseSalary" = $2 WHERE id = $1`, [r.id, target]);
        r.base = target;
        r.status = 'unpaid';
      }
      if (r.status === 'paid') continue;
      const net = r.base - r.deduction;
      if (net <= 0) {
        // Berilmagan oy (masalan fayldagi 0) — beriladigan narsa yo'q, qator yopiladi
        await ds.query(`UPDATE staff_salaries SET status = 'paid' WHERE id = $1`, [r.id]);
      } else {
        await salaries.pay(r.id, { amount: net, comment: COMMENT } as any, reqUser);
      }
      await backdate(r.id, month);
    }
    // To'lanmagan o'qituvchi qatorlari tizim hisobiga qaytadi (ensure unpaid qatorni sinxronlaydi)
    if (opts.apply) await salaries.ensureSalariesForMonth(opts.orgId, month);
    const rows = await load(month);
    out.push({
      month,
      paid: rows.filter((r) => r.status === 'paid').length,
      unpaid: rows.filter((r) => r.status !== 'paid').length,
      total: rows.reduce((s, r) => s + r.base, 0),
    });
  }
  return out;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (require.main === module) {
  (async () => {
    const { NestFactory } = await import('@nestjs/core');
    const { TelegramBotService } = await import('@/modules/telegram/telegram-bot.service');
    (TelegramBotService.prototype as any).onApplicationBootstrap = async () => undefined;
    const { AppModule } = await import('@/app.module');
    const { DataSource } = await import('typeorm');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    try {
      const orgId = Number(arg('--org') ?? 4);
      const [admin] = await app
        .get(DataSource)
        .query(`SELECT id FROM users WHERE login = $1 AND "organizationId" = $2`, [arg('--admin') ?? 'litech@talimplus.uz', orgId]);
      if (!admin) throw new Error('Admin topilmadi');
      const res = await settleSalaries(app, { orgId, adminId: admin.id, apply: process.argv.includes('--apply') });
      console.table(res);
    } finally {
      await app.close();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
