/**
 * Tashkilotni import oldidan TOZALASH (prod'dagi bo'sh bo'lmagan tashkilotga yuklash uchun).
 *
 * `import.ts --reset` faqat bitta filialni tozalaydi; bu skript butun tashkilotni:
 * barcha filiallardagi o'quvchi, guruh, lead, to'lov, davomat, xona, fan, syllabus,
 * xarajat, bayram, oylik/komissiya/jarima/xodim davomati va admin bo'lmagan xodimlar.
 *
 * SAQLANADI: tashkilot, obuna, rollar, Telegram bot sozlamasi, filiallar (bo'sh holda),
 * `admin` turidagi foydalanuvchilar (import `--admin` bilan shulardan birini topadi).
 *
 * Standart rejim — quruq yurish: hammasi tranzaksiyada bajariladi, nima o'chishi
 * sanab ko'rsatiladi va ROLLBACK qilinadi. Haqiqatda o'chirish uchun `--apply`
 * va xato tashkilotni tozalab yubormaslik uchun `--confirm <tashkilot nomi>`.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/legacy-import/litech/purge-org.ts --org 27 [--apply --confirm "LITECH"]
 */
import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';
import { dataSourceOptions } from '../../../db/data-source';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const CENTERS = `SELECT id FROM centers WHERE "organizationId" = $1`;
const STUDENTS = `SELECT id FROM students WHERE "centerId" IN (${CENTERS})`;
const GROUPS = `SELECT id FROM groups WHERE "centerId" IN (${CENTERS})`;
const USERS = `SELECT id FROM users WHERE "organizationId" = $1`;
const STAFF = `SELECT id FROM users WHERE "organizationId" = $1 AND role <> 'admin' AND "studentId" IS NULL`;

/** Hisobot uchun: jadval → shu tashkilotga tegishli qatorlar */
const COUNTS: Record<string, string> = {
  students: `SELECT count(*) FROM students WHERE id IN (${STUDENTS})`,
  groups: `SELECT count(*) FROM groups WHERE id IN (${GROUPS})`,
  payments: `SELECT count(*) FROM payments WHERE "studentId" IN (${STUDENTS})`,
  payment_receipts: `SELECT count(*) FROM payment_receipts WHERE "paymentId" IN (SELECT id FROM payments WHERE "studentId" IN (${STUDENTS}))`,
  attendance: `SELECT count(*) FROM attendance WHERE "groupId" IN (${GROUPS})`,
  leads: `SELECT count(*) FROM leads WHERE "organizationId" = $1 OR "centerId" IN (${CENTERS})`,
  rooms: `SELECT count(*) FROM rooms WHERE "centerId" IN (${CENTERS})`,
  subjects: `SELECT count(*) FROM subjects WHERE "centerId" IN (${CENTERS})`,
  syllabuses: `SELECT count(*) FROM syllabuses WHERE "centerId" IN (${CENTERS})`,
  expenses: `SELECT count(*) FROM expenses WHERE "centerId" IN (${CENTERS})`,
  holidays: `SELECT count(*) FROM holidays WHERE "organizationId" = $1`,
  staff_salaries: `SELECT count(*) FROM staff_salaries WHERE "userId" IN (${USERS})`,
  teacher_monthly_earnings: `SELECT count(*) FROM teacher_monthly_earnings WHERE "teacherId" IN (${USERS})`,
  staff_deductions: `SELECT count(*) FROM staff_deductions WHERE "organizationId" = $1`,
  staff_attendances: `SELECT count(*) FROM staff_attendances WHERE "organizationId" = $1`,
  telegram_parent_links: `SELECT count(*) FROM telegram_parent_links WHERE "organizationId" = $1`,
  'users (xodim)': `SELECT count(*) FROM users WHERE id IN (${STAFF})`,
  'users (o‘quvchi kabineti)': `SELECT count(*) FROM users WHERE "organizationId" = $1 AND "studentId" IS NOT NULL`,
  'users (admin — qoladi)': `SELECT count(*) FROM users WHERE "organizationId" = $1 AND role = 'admin' AND "studentId" IS NULL`,
  'centers (qoladi)': `SELECT count(*) FROM centers WHERE "organizationId" = $1`,
  'roles (qoladi)': `SELECT count(*) FROM roles WHERE "organizationId" = $1`,
};

// Tartib muhim: `students_groups_groups.groupsId` NO ACTION — guruhdan oldin o'chadi.
// Qolganlari FK CASCADE orqali ketadi (payments → receipts, groups → jadval/pauza/davr,
// students → a'zolik/chegirma/telegram/kabinet akkaunti, users → oylik/daromad/davomat).
const STEPS: string[] = [
  `DELETE FROM students_groups_groups WHERE "groupsId" IN (${GROUPS}) OR "studentsId" IN (${STUDENTS})`,
  `DELETE FROM leads WHERE "organizationId" = $1 OR "centerId" IN (${CENTERS})`,
  `DELETE FROM users WHERE "organizationId" = $1 AND "studentId" IS NOT NULL`,
  `DELETE FROM students WHERE id IN (${STUDENTS})`,
  `DELETE FROM groups WHERE id IN (${GROUPS})`,
  `DELETE FROM syllabuses WHERE "centerId" IN (${CENTERS})`,
  `DELETE FROM subjects WHERE "centerId" IN (${CENTERS})`,
  `DELETE FROM rooms WHERE "centerId" IN (${CENTERS})`,
  `DELETE FROM expenses WHERE "centerId" IN (${CENTERS})`,
  `DELETE FROM holidays WHERE "organizationId" = $1`,
  `DELETE FROM staff_deductions WHERE "organizationId" = $1`,
  `DELETE FROM staff_attendances WHERE "organizationId" = $1`,
  // Admin ham oylik/daromad qatoriga ega bo'lishi mumkin — ular ham tozalanadi
  `DELETE FROM teacher_commission_carryovers WHERE "teacherId" IN (${USERS})`,
  `DELETE FROM teacher_monthly_earnings WHERE "teacherId" IN (${USERS})`,
  `DELETE FROM staff_salaries WHERE "userId" IN (${USERS})`,
  `DELETE FROM user_pay_periods WHERE "userId" IN (${USERS})`,
  `DELETE FROM users WHERE id IN (${STAFF})`,
];

async function counts(
  m: EntityManager,
  orgId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, sql] of Object.entries(COUNTS))
    out[name] = Number((await m.query(sql, [orgId]))[0].count);
  return out;
}

async function main() {
  const orgId = Number(arg('--org'));
  if (!orgId) throw new Error('--org majburiy');
  const apply = process.argv.includes('--apply');

  const ds = await new DataSource({
    ...dataSourceOptions,
    entities: [],
    migrations: [],
  }).initialize();
  try {
    const [org] = await ds.query(
      `SELECT id, name FROM organizations WHERE id = $1`,
      [orgId],
    );
    if (!org) throw new Error(`Tashkilot ${orgId} topilmadi`);
    console.log(
      `Baza: ${dataSourceOptions['host']}/${dataSourceOptions['database']}`,
    );
    console.log(`Tashkilot: #${org.id} "${org.name}"`);
    console.table(
      await ds.query(
        `SELECT id, name FROM centers WHERE "organizationId" = $1 ORDER BY id`,
        [orgId],
      ),
    );
    console.table(
      await ds.query(
        `SELECT id, login, "firstName" FROM users WHERE "organizationId" = $1 AND role = 'admin' AND "studentId" IS NULL`,
        [orgId],
      ),
    );
    if (apply && arg('--confirm') !== org.name) {
      throw new Error(
        `--apply uchun --confirm "${org.name}" kerak (tashkilot nomi aynan)`,
      );
    }

    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const before = await counts(qr.manager, orgId);
      for (const sql of STEPS) await qr.query(sql, [orgId]);
      const after = await counts(qr.manager, orgId);
      console.table(
        Object.keys(before).map((t) => ({
          jadval: t,
          oldin: before[t],
          keyin: after[t],
        })),
      );
      if (apply) {
        await qr.commitTransaction();
        console.log('✅ Tozalandi.');
      } else {
        await qr.rollbackTransaction();
        console.log(
          'Quruq yurish — hech narsa o‘chirilmadi (ROLLBACK). O‘chirish: --apply --confirm "<nom>"',
        );
      }
    } catch (e) {
      await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
