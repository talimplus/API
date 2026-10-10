import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O'quvchining fanlari — cheklanmagan ro'yxat (`student_subjects`).
 *
 * Ilgari ikkita ustun edi (`subjectId` + `secondSubjectId`), ya'ni qabulda
 * ko'pi bilan ikki fan. Endi o'quvchi istalgancha fanga yozilishi mumkin.
 * `students.subjectId` saqlanib qoladi — u ro'yxatdagi birinchi fanning nusxasi
 * (eski front va to'lov chekidagi "fan" shu ustundan o'qiydi).
 * Fan faqat qabul uchun ma'lumot — to'lovga ta'sir qilmaydi.
 */
export class StudentSubjects1760000000068 implements MigrationInterface {
  name = 'StudentSubjects1760000000068';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "student_subjects" (
        "studentId" integer NOT NULL,
        "subjectId" integer NOT NULL,
        CONSTRAINT "PK_student_subjects" PRIMARY KEY ("studentId", "subjectId"),
        CONSTRAINT "FK_student_subjects_student" FOREIGN KEY ("studentId")
          REFERENCES "students"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_student_subjects_subject" FOREIGN KEY ("subjectId")
          REFERENCES "subjects"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_student_subjects_subject" ON "student_subjects" ("subjectId")`,
    );

    // Backfill: mavjud birinchi va ikkinchi fan.
    await queryRunner.query(`
      INSERT INTO "student_subjects" ("studentId", "subjectId")
      SELECT "id", "subjectId" FROM "students" WHERE "subjectId" IS NOT NULL
      UNION
      SELECT "id", "secondSubjectId" FROM "students" WHERE "secondSubjectId" IS NOT NULL
      ON CONFLICT DO NOTHING
    `);

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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "secondSubjectId" integer`,
    );
    await queryRunner.query(`
      ALTER TABLE "students"
        ADD CONSTRAINT "FK_students_second_subject"
        FOREIGN KEY ("secondSubjectId") REFERENCES "subjects"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_students_second_subject" ON "students" ("secondSubjectId")`,
    );
    // Ikkinchi fan sifatida birinchisidan farqli eng kichik id qaytariladi.
    await queryRunner.query(`
      UPDATE "students" s SET "secondSubjectId" = x."subjectId"
      FROM (
        SELECT ss."studentId", MIN(ss."subjectId") AS "subjectId"
        FROM "student_subjects" ss
        JOIN "students" st ON st."id" = ss."studentId"
        WHERE st."subjectId" IS NULL OR ss."subjectId" <> st."subjectId"
        GROUP BY ss."studentId"
      ) x
      WHERE x."studentId" = s."id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_subjects"`);
  }
}
