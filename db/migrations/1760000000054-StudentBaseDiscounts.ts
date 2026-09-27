import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O'quvchining doimiy chegirmasi tarixi (oy aniqligida).
 *
 * Maqsad: chegirma o'zgartirilganda o'tgan oylar qayta narxlanmasligi, shu oy
 * uchun pul berilgan bo'lsa — yangi chegirma keyingi oydan kuchga kirishi.
 *
 * Backfill: chegirmasi bor har bir o'quvchi uchun bitta qator — hozirgi qiymat,
 * o'quvchi yaratilgan oydan boshlab. Shu sabab migratsiyadan keyin hisob-kitob
 * o'zgarmaydi.
 */
export class StudentBaseDiscounts1760000000054 implements MigrationInterface {
  name = 'StudentBaseDiscounts1760000000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "student_base_discounts" (
        "id" SERIAL NOT NULL,
        "studentId" integer NOT NULL,
        "fromMonth" date NOT NULL,
        "percent" numeric NOT NULL DEFAULT 0,
        "amount" numeric NOT NULL DEFAULT 0,
        "reason" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_student_base_discounts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_student_base_discounts_student_month"
        ON "student_base_discounts" ("studentId", "fromMonth")
    `);

    await queryRunner.query(`
      ALTER TABLE "student_base_discounts"
      DROP CONSTRAINT IF EXISTS "FK_student_base_discounts_student"
    `);
    await queryRunner.query(`
      ALTER TABLE "student_base_discounts"
      ADD CONSTRAINT "FK_student_base_discounts_student"
      FOREIGN KEY ("studentId") REFERENCES "students"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      INSERT INTO "student_base_discounts"
             ("studentId", "fromMonth", "percent", "amount", "reason")
      SELECT s."id",
             DATE_TRUNC('month', s."createdAt")::date,
             COALESCE(s."discountPercent", 0),
             COALESCE(s."discountAmount", 0),
             s."discountReason"
        FROM "students" s
       WHERE COALESCE(s."discountPercent", 0) > 0
          OR COALESCE(s."discountAmount", 0) > 0
      ON CONFLICT ("studentId", "fromMonth") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "student_base_discounts"`);
  }
}
