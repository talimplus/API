import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O'quvchining ikkinchi fani (`students.secondSubjectId`).
 *
 * Qabulda o'quvchi ikki fanga yozilishi mumkin (masalan ingliz tili +
 * matematika). Fan faqat qabul bosqichi uchun ma'lumot — to'lov guruhdan
 * hisoblanadi, shuning uchun alohida jadval emas, bitta ustun yetarli.
 */
export class StudentSecondSubject1760000000065 implements MigrationInterface {
  name = 'StudentSecondSubject1760000000065';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "secondSubjectId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "FK_students_second_subject"`,
    );
    await queryRunner.query(`
      ALTER TABLE "students"
        ADD CONSTRAINT "FK_students_second_subject"
        FOREIGN KEY ("secondSubjectId") REFERENCES "subjects"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_students_second_subject" ON "students" ("secondSubjectId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_students_second_subject"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "FK_students_second_subject"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN IF EXISTS "secondSubjectId"`,
    );
  }
}
