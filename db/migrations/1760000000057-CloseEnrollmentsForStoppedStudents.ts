import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * To'xtatilgan o'quvchilarning ochiq a'zolik oynalarini yopish.
 *
 * Ilgari o'quvchi to'xtatilganda faqat `students.stoppedAt` yozilardi, qayta
 * faollashganda esa `activatedAt` bugungi sanaga qayta yozilib `stoppedAt`
 * tozalanardi. Natijada to'xtashdan oldingi oylar proratsiyasi yo'qolardi
 * (qarz o'chib ketardi). Endi to'xtatishda oynalar yopiladi, qaytishda
 * yangi oyna ochiladi.
 *
 * Backfill: hozir `stopped` holatidagi o'quvchilarning ochiq oynalari
 * `stoppedAt` kuni yopiladi — ular qaytganda to'xtab turgan davr to'lovga
 * kirmasligi uchun.
 */
export class CloseEnrollmentsForStoppedStudents1760000000057
  implements MigrationInterface
{
  name = 'CloseEnrollmentsForStoppedStudents1760000000057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "student_group_enrollments" e
         SET "leftAt" = GREATEST(e."joinedAt", s."stoppedAt"::date),
             "leftReason" = COALESCE(e."leftReason", 'O''quvchi to''xtatildi')
        FROM "students" s
       WHERE s."id" = e."studentId"
         AND s."status" = 'stopped'
         AND s."stoppedAt" IS NOT NULL
         AND e."leftAt" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // Ma'lumotni qaytarib bo'lmaydi (qaysi oyna ochiq bo'lgani saqlanmagan).
  }
}
