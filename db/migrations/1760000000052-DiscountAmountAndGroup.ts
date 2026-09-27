import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CHEGIRMA: FOIZ YOKI SUMMA, VA QAYSI FANGA.
 *
 * Markazlar chegirmani ikki xil beradi: foizda (10%) yoki qat'iy summada
 * (oyiga 20 000 so'm). Ikki fanda o'qiydigan o'quvchiga chegirma odatda
 * **arzonroq fanga** beriladi — shuning uchun davr bitta guruhga bog'lanishi
 * mumkin (`groupId`; NULL — o'quvchining barcha guruhlariga, eski xatti-harakat).
 *
 * - `student_discount_periods.amount` — oyiga ayiriladigan summa (so'm).
 *   Bir davrda `percent` yoki `amount` dan bittasi ishlatiladi.
 * - `students.discountAmount` — `discountPercent` ning summadagi jufti
 *   (davrsiz, doimiy chegirma).
 *
 * Mavjud yozuvlar o'zgarmaydi: amount = 0, groupId = NULL.
 */
export class DiscountAmountAndGroup1760000000052 implements MigrationInterface {
  name = 'DiscountAmountAndGroup1760000000052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "student_discount_periods"
        ADD COLUMN IF NOT EXISTS "amount" numeric NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "groupId" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "student_discount_periods"
        DROP CONSTRAINT IF EXISTS "FK_student_discount_periods_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "student_discount_periods"
        ADD CONSTRAINT "FK_student_discount_periods_group"
        FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_student_discount_periods_group"
        ON "student_discount_periods" ("groupId")
    `);
    await queryRunner.query(`
      ALTER TABLE "students"
        ADD COLUMN IF NOT EXISTS "discountAmount" numeric NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN IF EXISTS "discountAmount"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_student_discount_periods_group"`,
    );
    await queryRunner.query(`
      ALTER TABLE "student_discount_periods"
        DROP CONSTRAINT IF EXISTS "FK_student_discount_periods_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "student_discount_periods"
        DROP COLUMN IF EXISTS "groupId",
        DROP COLUMN IF EXISTS "amount"
    `);
  }
}
