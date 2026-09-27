import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kelmagan o'quvchilar ro'yxati (qabulxona uchun).
 *
 * Qabulxona kelmagan o'quvchiga qo'ng'iroq qiladi va natijani shu yerga
 * yozadi: nega kelmagani (`followUpNote`), qachon va kim qo'ng'iroq qilgani.
 * Ro'yxatda "hali qo'ng'iroq qilinmaganlar" filtri shu ustunlarga tayanadi.
 */
export class AttendanceFollowUp1760000000060 implements MigrationInterface {
  name = 'AttendanceFollowUp1760000000060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "attendance"
        ADD COLUMN IF NOT EXISTS "followUpNote" text,
        ADD COLUMN IF NOT EXISTS "followedUpAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "followedUpById" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "attendance"
      DROP CONSTRAINT IF EXISTS "FK_attendance_followed_up_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "attendance"
      ADD CONSTRAINT "FK_attendance_followed_up_by"
      FOREIGN KEY ("followedUpById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    // Ro'yxat sana oralig'i + status bo'yicha o'qiladi.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_attendance_status_date"
        ON "attendance" ("status", "lessonDate")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_attendance_status_date"`,
    );
    await queryRunner.query(`
      ALTER TABLE "attendance"
      DROP CONSTRAINT IF EXISTS "FK_attendance_followed_up_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "attendance"
        DROP COLUMN IF EXISTS "followUpNote",
        DROP COLUMN IF EXISTS "followedUpAt",
        DROP COLUMN IF EXISTS "followedUpById"
    `);
  }
}
