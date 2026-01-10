import { MigrationInterface, QueryRunner } from 'typeorm';

export class MonthlyExpenses1760000000006 implements MigrationInterface {
  name = 'MonthlyExpenses1760000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expenses"
      ADD COLUMN IF NOT EXISTS "description" text
    `);

    // Rename expenseDate -> forMonth (monthly accounting)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name='expenses' AND column_name='expenseDate'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name='expenses' AND column_name='forMonth'
        ) THEN
          ALTER TABLE "expenses" RENAME COLUMN "expenseDate" TO "forMonth";
        END IF;
      END $$;
    `);

    // Ensure forMonth is DATE and normalized to first day of month
    await queryRunner.query(`
      ALTER TABLE "expenses"
      ALTER COLUMN "forMonth" TYPE date
      USING date_trunc('month', "forMonth")::date
    `);

    await queryRunner.query(`
      ALTER TABLE "expenses"
      ALTER COLUMN "forMonth" SET DEFAULT date_trunc('month', now())::date
    `);

    // Increase amount precision
    await queryRunner.query(`
      ALTER TABLE "expenses"
      ALTER COLUMN "amount" TYPE numeric(14,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert amount precision
    await queryRunner.query(`
      ALTER TABLE "expenses"
      ALTER COLUMN "amount" TYPE numeric(10,2)
    `);

    // Revert forMonth column name back to expenseDate (best-effort)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name='expenses' AND column_name='forMonth'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name='expenses' AND column_name='expenseDate'
        ) THEN
          ALTER TABLE "expenses" RENAME COLUMN "forMonth" TO "expenseDate";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "expenses"
      DROP COLUMN IF EXISTS "description"
    `);
  }
}

