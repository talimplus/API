import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O'quvchining shaxsiy narxi ham oyga bog'lanadi.
 *
 * Ilgari `students.monthlyFee` o'zgartirilsa, oxirgi 3 oyning barcha
 * to'lanmagan/qisman qatorlari yangi narxda qayta hisoblanardi — o'tgan
 * oyning qarzi o'z-o'zidan o'zgarib ketardi. Endi shaxsiy narx doimiy chegirma
 * bilan bir tarixda (`student_base_discounts`) saqlanadi va bir xil qoida
 * bilan kuchga kiradi: shu oy uchun pul olinmagan bo'lsa — shu oydan,
 * olingan bo'lsa — keyingi oydan.
 *
 * `monthlyFee` NULL — shu davrda shaxsiy narx tarixda yozilmagan (eski
 * qator): `students.monthlyFee` ishlatiladi. Backfill mavjud qatorlarga
 * hozirgi qiymatni yozadi — migratsiyadan keyin hisob o'zgarmaydi.
 */
export class StudentFeeHistory1760000000061 implements MigrationInterface {
  name = 'StudentFeeHistory1760000000061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "student_base_discounts"
      ADD COLUMN IF NOT EXISTS "monthlyFee" numeric
    `);
    await queryRunner.query(`
      UPDATE "student_base_discounts" d
         SET "monthlyFee" = COALESCE(s."monthlyFee", 0)
        FROM "students" s
       WHERE s."id" = d."studentId" AND d."monthlyFee" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_base_discounts" DROP COLUMN IF EXISTS "monthlyFee"`,
    );
  }
}
