import { MigrationInterface, QueryRunner } from 'typeorm';

export class AttendanceLessonExistenceSeparation1760000000001
  implements MigrationInterface
{
  name = 'AttendanceLessonExistenceSeparation1760000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- groups: add schedule boundaries + timezone + status (needed for schedule-driven lesson existence)
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."groups_status_enum" AS ENUM('active', 'inactive', 'completed');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "timezone" character varying NOT NULL DEFAULT 'Asia/Tashkent'`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "startDate" date NOT NULL DEFAULT CURRENT_DATE`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "endDate" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "status" "public"."groups_status_enum" NOT NULL DEFAULT 'active'`,
    );

    // ---- attendance: persisted facts only, keyed by (groupId, studentId, lessonDate)
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."attendance_status_enum" AS ENUM('present', 'absent', 'late', 'excused');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Rename date -> lessonDate (DATE in group timezone)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='attendance' AND column_name='date'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='attendance' AND column_name='lessonDate'
        ) THEN
          ALTER TABLE "attendance" RENAME COLUMN "date" TO "lessonDate";
        END IF;
      END $$;
    `);

    // Rename reason -> comment
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='attendance' AND column_name='reason'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='attendance' AND column_name='comment'
        ) THEN
          ALTER TABLE "attendance" RENAME COLUMN "reason" TO "comment";
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "attendance" ALTER COLUMN "comment" TYPE text`,
    );

    // status + audit columns
    await queryRunner.query(
      `ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "status" "public"."attendance_status_enum" NOT NULL DEFAULT 'present'`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='attendance' AND column_name='isPresent'
        ) THEN
          UPDATE "attendance"
          SET "status" = CASE
            WHEN "isPresent" = true THEN 'present'::"public"."attendance_status_enum"
            ELSE 'absent'::"public"."attendance_status_enum"
          END;
          ALTER TABLE "attendance" DROP COLUMN "isPresent";
        END IF;
      END $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "submittedById" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );

    // Clean invalid legacy rows before making keys non-null
    await queryRunner.query(
      `DELETE FROM "attendance" WHERE "studentId" IS NULL OR "groupId" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "attendance" ALTER COLUMN "studentId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" ALTER COLUMN "groupId" SET NOT NULL`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'UQ_attendance_group_student_lessonDate'
        ) THEN
          ALTER TABLE "attendance"
          ADD CONSTRAINT "UQ_attendance_group_student_lessonDate"
          UNIQUE ("groupId", "studentId", "lessonDate");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_attendance_submitted_by'
        ) THEN
          ALTER TABLE "attendance"
          ADD CONSTRAINT "FK_attendance_submitted_by"
          FOREIGN KEY ("submittedById") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "attendance" DROP CONSTRAINT "FK_attendance_submitted_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" DROP CONSTRAINT "UQ_attendance_group_student_lessonDate"`,
    );

    await queryRunner.query(`ALTER TABLE "attendance" DROP COLUMN "updatedAt"`);
    await queryRunner.query(
      `ALTER TABLE "attendance" DROP COLUMN "submittedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" DROP COLUMN "submittedById"`,
    );

    await queryRunner.query(
      `ALTER TABLE "attendance" ADD "isPresent" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `UPDATE "attendance" SET "isPresent" = CASE WHEN "status" = 'present' THEN true ELSE false END`,
    );
    await queryRunner.query(`ALTER TABLE "attendance" DROP COLUMN "status"`);

    await queryRunner.query(
      `ALTER TABLE "attendance" ALTER COLUMN "comment" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" RENAME COLUMN "comment" TO "reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" RENAME COLUMN "lessonDate" TO "date"`,
    );

    await queryRunner.query(`DROP TYPE "public"."attendance_status_enum"`);

    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "status"`);
    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "endDate"`);
    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "startDate"`);
    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "timezone"`);
    await queryRunner.query(`DROP TYPE "public"."groups_status_enum"`);
  }
}


