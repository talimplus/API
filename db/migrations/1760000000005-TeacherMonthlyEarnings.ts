import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeacherMonthlyEarnings1760000000005 implements MigrationInterface {
  name = 'TeacherMonthlyEarnings1760000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "teacher_monthly_earnings" (
        "id" SERIAL NOT NULL,
        "teacherId" integer NOT NULL,
        "forMonth" date NOT NULL,
        "baseSalarySnapshot" numeric(14,2) NOT NULL DEFAULT '0',
        "commissionAmount" numeric(14,2) NOT NULL DEFAULT '0',
        "carryOverCommission" numeric(14,2) NOT NULL DEFAULT '0',
        "totalEarning" numeric(14,2) NOT NULL DEFAULT '0',
        "calculatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_teacher_monthly_earnings_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_teacher_monthly_earnings_teacher') THEN
          ALTER TABLE "teacher_monthly_earnings"
          ADD CONSTRAINT "FK_teacher_monthly_earnings_teacher"
          FOREIGN KEY ("teacherId") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_teacher_monthly_earnings_teacher_forMonth') THEN
          ALTER TABLE "teacher_monthly_earnings"
          ADD CONSTRAINT "UQ_teacher_monthly_earnings_teacher_forMonth"
          UNIQUE ("teacherId", "forMonth");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "teacher_commission_carryovers" (
        "id" SERIAL NOT NULL,
        "teacherId" integer NOT NULL,
        "sourceForMonth" date NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "appliedForMonth" date,
        "appliedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_teacher_commission_carryovers_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_teacher_commission_carryovers_teacher') THEN
          ALTER TABLE "teacher_commission_carryovers"
          ADD CONSTRAINT "FK_teacher_commission_carryovers_teacher"
          FOREIGN KEY ("teacherId") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "teacher_commission_carryovers" DROP CONSTRAINT IF EXISTS "FK_teacher_commission_carryovers_teacher"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "teacher_commission_carryovers"`);

    await queryRunner.query(
      `ALTER TABLE "teacher_monthly_earnings" DROP CONSTRAINT IF EXISTS "UQ_teacher_monthly_earnings_teacher_forMonth"`,
    );
    await queryRunner.query(
      `ALTER TABLE "teacher_monthly_earnings" DROP CONSTRAINT IF EXISTS "FK_teacher_monthly_earnings_teacher"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "teacher_monthly_earnings"`);
  }
}

