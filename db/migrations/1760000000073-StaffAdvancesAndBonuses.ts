import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xodim oyligiga avans va mukofot.
 *
 * - Avans — `staff_deductions` ning yangi turi (`advance`): pul hozir beriladi,
 *   tanlangan oy oyligidan ushlanadi, sig'masa keyingi oyliklardan (jarima
 *   bilan bir xil FIFO). Jarimadan farqi — bu xodimga BERILGAN pul, shuning
 *   uchun oylik qatorida alohida `advanceAmount` (`deductionAmount` ning
 *   avansdan iborat qismi) yuritiladi.
 * - Mukofot — `staff_bonuses`: tanlangan oy oyligiga qo'shiladi va oylik bilan
 *   birga beriladi. `staff_salaries.bonusAmount` — shu oy mukofotlari yig'indisi.
 *
 * `netSalary = baseSalary + bonusAmount − deductionAmount`.
 * Hozircha avans ham, mukofot ham yo'q — backfill 0.
 */
export class StaffAdvancesAndBonuses1760000000073
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "staff_deductions_type_enum" ADD VALUE IF NOT EXISTS 'advance'`,
    );

    await queryRunner.query(`
      ALTER TABLE "staff_salaries"
        ADD COLUMN IF NOT EXISTS "bonusAmount" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "advanceAmount" numeric(14,2) NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_bonuses" (
        "id" SERIAL PRIMARY KEY,
        "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "centerId" integer NULL REFERENCES "centers"("id") ON DELETE SET NULL,
        "organizationId" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "forMonth" date NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "reason" text NOT NULL,
        "createdById" integer NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_bonuses_user_month" ON "staff_bonuses" ("userId", "forMonth")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_bonuses"`);
    await queryRunner.query(`
      ALTER TABLE "staff_salaries"
        DROP COLUMN IF EXISTS "bonusAmount",
        DROP COLUMN IF EXISTS "advanceAmount"
    `);
    // Postgres enum qiymatini olib tashlab bo'lmaydi — `advance` qatorlari
    // `other` ga o'tkaziladi, qiymat esa turda qoladi (zararsiz).
    await queryRunner.query(
      `UPDATE "staff_deductions" SET "type" = 'other' WHERE "type" = 'advance'`,
    );
  }
}
