import { MigrationInterface, QueryRunner } from 'typeorm';

export class StaffSalaries1760000000004 implements MigrationInterface {
  name = 'StaffSalaries1760000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."staff_salaries_status_enum" AS ENUM('paid','unpaid','partial');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_salaries" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "forMonth" date NOT NULL,
        "baseSalary" numeric(14,2) NOT NULL,
        "paidAmount" numeric(14,2) NOT NULL DEFAULT '0',
        "status" "public"."staff_salaries_status_enum" NOT NULL DEFAULT 'unpaid',
        "paidAt" TIMESTAMP,
        "comment" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_salaries_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_staff_salaries_user'
        ) THEN
          ALTER TABLE "staff_salaries"
          ADD CONSTRAINT "FK_staff_salaries_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_staff_salaries_user_forMonth'
        ) THEN
          ALTER TABLE "staff_salaries"
          ADD CONSTRAINT "UQ_staff_salaries_user_forMonth"
          UNIQUE ("userId", "forMonth");
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_salaries" DROP CONSTRAINT IF EXISTS "UQ_staff_salaries_user_forMonth"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_salaries" DROP CONSTRAINT IF EXISTS "FK_staff_salaries_user"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_salaries"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."staff_salaries_status_enum"`,
    );
  }
}

