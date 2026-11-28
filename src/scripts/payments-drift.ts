/**
 * Solishtirish (faqat o'qiydi): `GET /payments` dan qayta hisob olib
 * tashlangani xavfsizmi — ya'ni har bir ochiq to'lov qatori bazada allaqachon
 * to'g'ri summada turibdimi.
 *
 * Har bir tashkilot uchun `syncOpenPayments({ dryRun: true })`: oxirgi 3 oyning
 * yetishmagan qatorlari va qayta hisobda o'zgaradigan / o'chadigan qatorlar
 * sanaladi. Hech narsa yozilmaydi. Farq 0 bo'lsa — eski "har ochilishda
 * hisoblash" hech narsa o'zgartirmayotgan edi.
 *
 *   node dist/src/scripts/payments-drift.js            # barcha tashkilotlar
 *   node dist/src/scripts/payments-drift.js --org=27   # bitta tashkilot
 *   ... --verbose                                       # har bir farqni chiqaradi
 */
process.env.TELEGRAM_DISABLED = 'true';

import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { PaymentsService } from '@/modules/payments/payments.service';

const SNAPSHOT_FIELDS = [
  'amountDue',
  'amountPaid',
  'refunded',
  'planned',
  'billable',
  'excused',
  'status',
  'dueDate',
  'hardDueDate',
];

function diffFields(before: string, after: string | null): string {
  if (after === null) return 'DELETE';
  const a = before.split('|');
  const b = after.split('|');
  return SNAPSHOT_FIELDS.map((f, i) =>
    a[i] !== b[i] ? `${f}: ${a[i]} → ${b[i]}` : null,
  )
    .filter(Boolean)
    .join(', ');
}

async function main() {
  const args = process.argv.slice(2);
  const orgArg = args.find((a) => a.startsWith('--org='));
  const verbose = args.includes('--verbose');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  // Skript hech narsa yozmasligi kerak — ilova cron'lari (00:10 va h.k.)
  // shu jarayonda ishga tushib ketmasin.
  const scheduler = app.get(SchedulerRegistry);
  for (const job of scheduler.getCronJobs().values()) job.stop();
  const payments = app.get(PaymentsService);
  const ds = app.get(DataSource);

  const orgs: { id: number; name: string }[] = orgArg
    ? await ds.query(`SELECT id, name FROM organizations WHERE id = $1`, [
        Number(orgArg.split('=')[1]),
      ])
    : await ds.query(`SELECT id, name FROM organizations ORDER BY id`);

  let total = 0;
  for (const org of orgs) {
    const r = await payments.syncOpenPayments(org.id, { dryRun: true });
    const n = r.created + r.updated + r.deleted;
    total += n;
    console.log(
      `org ${org.id} (${org.name}): created=${r.created} updated=${r.updated} deleted=${r.deleted} — ${r.durationMs} ms`,
    );
    if (verbose || n <= 20) {
      for (const k of r.createdKeys) console.log(`   + create ${k}`);
      for (const c of r.changes) {
        console.log(
          `   ~ payment ${c.paymentId} student=${c.studentId} group=${c.groupId} ${c.forMonth}: ${diffFields(c.before, c.after)}`,
        );
      }
    }
  }
  console.log(`\nJami farq: ${total}`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
