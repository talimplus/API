import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentDiscountPeriods1760000000008 implements MigrationInterface {
  name = 'StudentDiscountPeriods1760000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "student_discount_periods" (
        "id" SERIAL NOT NULL,
        "studentId" integer NOT NULL,
        "fromMonth" date NOT NULL,
        "toMonth" date,
        "percent" numeric NOT NULL DEFAULT '0',
        "reason" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_student_discount_periods_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_student_discount_periods_student'
        ) THEN
          ALTER TABLE "student_discount_periods"
          ADD CONSTRAINT "FK_student_discount_periods_student"
          FOREIGN KEY ("studentId") REFERENCES "students"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_student_discount_periods_student_months"
      ON "student_discount_periods" ("studentId", "fromMonth", "toMonth")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_discount_periods" DROP CONSTRAINT IF EXISTS "FK_student_discount_periods_student"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_student_discount_periods_student_months"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "student_discount_periods"`);
  }
}

