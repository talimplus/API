import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1) O'tgan kun davomati — faqat admin: `attendance.managePast` barcha
 *    (admin `*` dan tashqari) rollardan olib tashlanadi. Admin xohlasa keyin
 *    biror rolga qaytarib berishi mumkin.
 * 2) `attendance_changes` — davomat o'zgarishlari jurnali (`attendance` qatori
 *    ustidan yoziladi, kim nimani o'zgartirgani yo'qolardi).
 * 3) Doimiy chegirma guruh bo'yicha: `student_base_discounts.groupId`
 *    (NULL — barcha guruhlarga, mavjud qatorlar shunday qoladi).
 */
export class AttendanceLockAndGroupDiscounts1760000000076
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "roles"
         SET "permissions" = array_remove("permissions", 'attendance.managePast')
       WHERE 'attendance.managePast' = ANY("permissions")
         AND NOT ('*' = ANY("permissions"))
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attendance_changes" (
        "id" SERIAL PRIMARY KEY,
        "groupId" integer NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
        "studentId" integer NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "lessonDate" date NOT NULL,
        "oldStatus" text,
        "newStatus" text NOT NULL,
        "actorId" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "byGroupTeacher" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_attendance_changes_group"
        ON "attendance_changes" ("groupId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_attendance_changes_student"
        ON "attendance_changes" ("studentId", "createdAt")
    `);

    await queryRunner.query(`
      ALTER TABLE "student_base_discounts"
        ADD COLUMN IF NOT EXISTS "groupId" integer REFERENCES "groups"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_student_base_discounts_student_month"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_student_base_discounts_scope_month"
        ON "student_base_discounts" ("studentId", COALESCE("groupId", 0), "fromMonth")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "student_base_discounts" WHERE "groupId" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_student_base_discounts_scope_month"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_base_discounts" DROP COLUMN IF EXISTS "groupId"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_student_base_discounts_student_month"
        ON "student_base_discounts" ("studentId", "fromMonth")
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "attendance_changes"`);
    // Rollardan olingan ruxsat qaytarilmaydi: kimda bo'lgani saqlanmagan.
  }
}
