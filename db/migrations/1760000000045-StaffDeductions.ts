import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Oylikdan ushlab qolish (jarimalar).
 *
 * 1. `staff_deductions` — jarimaning o'zi (summa + sabab). Oylikdan katta
 *    bo'lishi mumkin, shuning uchun `appliedAmount` bilan qismlab qoplanadi.
 * 2. `staff_salary_deductions` — qaysi oy oyligidan qanchasi ushlangani.
 * 3. `staff_salaries.deductionAmount` — shu oyda ushlangan yig'indi
 *    (ro'yxatni tez chizish uchun denormalizatsiya).
 * 4. Tizim rollariga yangi ruxsatlar.
 */
export class StaffDeductions1760000000045 implements MigrationInterface {
  name = 'StaffDeductions1760000000045';

  private static addPerms(baseRole: string, keys: string[]): string {
    const wanted = keys.map((key) => `'${key}'`).join(', ');
    return `
      UPDATE "roles"
      SET "permissions" = "permissions" || ARRAY(
        SELECT unnest(ARRAY[${wanted}]::text[])
        EXCEPT
        SELECT unnest("permissions")
      )
      WHERE "isSystem" = true AND "baseRole" = '${baseRole}'
    `;
  }

  private static removePerms(baseRole: string, keys: string[]): string {
    const expr = keys.reduce(
      (acc, key) => `array_remove(${acc}, '${key}')`,
      '"permissions"',
    );
    return `
      UPDATE "roles"
      SET "permissions" = ${expr}
      WHERE "isSystem" = true AND "baseRole" = '${baseRole}'
    `;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const M = StaffDeductions1760000000045;

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "staff_deductions_type_enum" AS ENUM ('late', 'unsettled_payment', 'other');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_deductions" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "centerId" integer,
        "organizationId" integer NOT NULL,
        "sourceForMonth" date NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "appliedAmount" numeric(14,2) NOT NULL DEFAULT 0,
        "type" "staff_deductions_type_enum" NOT NULL DEFAULT 'other',
        "reason" text NOT NULL,
        "settledAt" TIMESTAMP,
        "createdById" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_deductions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_staff_deductions_user_month"
        ON "staff_deductions" ("userId", "sourceForMonth")
    `);

    for (const [name, column, table, onDelete] of [
      ['FK_staff_deductions_user', 'userId', 'users', 'CASCADE'],
      ['FK_staff_deductions_center', 'centerId', 'centers', 'SET NULL'],
      ['FK_staff_deductions_org', 'organizationId', 'organizations', 'CASCADE'],
      ['FK_staff_deductions_created_by', 'createdById', 'users', 'SET NULL'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "staff_deductions" DROP CONSTRAINT IF EXISTS "${name}"`,
      );
      await queryRunner.query(`
        ALTER TABLE "staff_deductions"
          ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}")
          REFERENCES "${table}"("id") ON DELETE ${onDelete}
      `);
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_salary_deductions" (
        "id" SERIAL NOT NULL,
        "staffSalaryId" integer NOT NULL,
        "deductionId" integer NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_salary_deductions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_staff_salary_deductions_salary"
        ON "staff_salary_deductions" ("staffSalaryId")
    `);
    // Bitta jarima bitta oylikka faqat bitta qator bilan bog'lanadi
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_staff_salary_deductions_pair"
        ON "staff_salary_deductions" ("staffSalaryId", "deductionId")
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_salary_deductions"
        DROP CONSTRAINT IF EXISTS "FK_staff_salary_deductions_salary"
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_salary_deductions"
        ADD CONSTRAINT "FK_staff_salary_deductions_salary"
        FOREIGN KEY ("staffSalaryId") REFERENCES "staff_salaries"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_salary_deductions"
        DROP CONSTRAINT IF EXISTS "FK_staff_salary_deductions_deduction"
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_salary_deductions"
        ADD CONSTRAINT "FK_staff_salary_deductions_deduction"
        FOREIGN KEY ("deductionId") REFERENCES "staff_deductions"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "staff_salaries"
        ADD COLUMN IF NOT EXISTS "deductionAmount" numeric(14,2) NOT NULL DEFAULT 0
    `);

    await queryRunner.query(
      M.addPerms('manager', ['staffPerformance.view']),
    );
    await queryRunner.query(
      M.addPerms('reception', ['staffPerformance.view']),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const M = StaffDeductions1760000000045;

    await queryRunner.query(M.removePerms('manager', ['staffPerformance.view']));
    await queryRunner.query(
      M.removePerms('reception', ['staffPerformance.view']),
    );

    await queryRunner.query(
      `ALTER TABLE "staff_salaries" DROP COLUMN IF EXISTS "deductionAmount"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_salary_deductions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_deductions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "staff_deductions_type_enum"`);
  }
}
