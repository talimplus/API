import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentsRedesign1760000000002 implements MigrationInterface {
  name = 'PaymentsRedesign1760000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- students: universal discounts + activation timestamp
    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "discountPercent" numeric NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "discountReason" text`,
    );
    await queryRunner.query(`ALTER TABLE "students" ADD "activatedAt" TIMESTAMP`);

    // Backfill: for existing ACTIVE students, activatedAt = createdAt if unknown
    await queryRunner.query(
      `UPDATE "students" SET "activatedAt" = "createdAt" WHERE "status" = 'ACTIVE' AND "activatedAt" IS NULL`,
    );

    // Drop legacy referralDiscount (replaced by discountPercent/discountReason)
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN IF EXISTS "referralDiscount"`,
    );

    // ---- payments: due dates + lesson counts + unique key
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dueDate" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "hardDueDate" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "lessonsPlanned" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "lessonsBillable" integer`,
    );

    // Backfill due dates for existing rows (forMonth is first day of month)
    await queryRunner.query(
      `UPDATE "payments"
       SET "dueDate" = ("forMonth" + INTERVAL '9 day')::date,
           "hardDueDate" = ("forMonth" + INTERVAL '14 day')::date
       WHERE "forMonth" IS NOT NULL AND ("dueDate" IS NULL OR "hardDueDate" IS NULL)`,
    );

    // De-duplicate if historical duplicates exist (keep smallest id)
    await queryRunner.query(
      `DELETE FROM "payments" p
       USING "payments" p2
       WHERE p."studentId" = p2."studentId"
         AND p."groupId" = p2."groupId"
         AND p."forMonth" = p2."forMonth"
         AND p."id" > p2."id"`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'UQ_payments_student_group_forMonth'
        ) THEN
          ALTER TABLE "payments"
          ADD CONSTRAINT "UQ_payments_student_group_forMonth"
          UNIQUE ("studentId", "groupId", "forMonth");
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "UQ_payments_student_group_forMonth"`,
    );

    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "lessonsBillable"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "lessonsPlanned"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "hardDueDate"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "dueDate"`);

    await queryRunner.query(
      `ALTER TABLE "students" ADD "referralDiscount" numeric NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "activatedAt"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "discountReason"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "discountPercent"`);
  }
}


