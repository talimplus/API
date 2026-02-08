import { MigrationInterface, QueryRunner } from 'typeorm';

export class AttendanceLessonReschedule1760000000025
  implements MigrationInterface
{
  name = 'AttendanceLessonReschedule1760000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attendance_lesson_overrides" (
        "id" SERIAL NOT NULL,
        "fromDate" date NOT NULL,
        "toDate" date NOT NULL,
        "reason" text,
        "groupId" integer NOT NULL,
        "createdById" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attendance_lesson_overrides_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_attendance_lesson_overrides_group'
        ) THEN
          ALTER TABLE "attendance_lesson_overrides"
          ADD CONSTRAINT "FK_attendance_lesson_overrides_group"
          FOREIGN KEY ("groupId") REFERENCES "groups"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_attendance_lesson_overrides_created_by'
        ) THEN
          ALTER TABLE "attendance_lesson_overrides"
          ADD CONSTRAINT "FK_attendance_lesson_overrides_created_by"
          FOREIGN KEY ("createdById") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'UQ_attendance_lesson_overrides_from'
        ) THEN
          ALTER TABLE "attendance_lesson_overrides"
          ADD CONSTRAINT "UQ_attendance_lesson_overrides_from"
          UNIQUE ("groupId", "fromDate");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'UQ_attendance_lesson_overrides_to'
        ) THEN
          ALTER TABLE "attendance_lesson_overrides"
          ADD CONSTRAINT "UQ_attendance_lesson_overrides_to"
          UNIQUE ("groupId", "toDate");
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "attendance_lesson_overrides" DROP CONSTRAINT IF EXISTS "UQ_attendance_lesson_overrides_to"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_lesson_overrides" DROP CONSTRAINT IF EXISTS "UQ_attendance_lesson_overrides_from"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_lesson_overrides" DROP CONSTRAINT IF EXISTS "FK_attendance_lesson_overrides_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_lesson_overrides" DROP CONSTRAINT IF EXISTS "FK_attendance_lesson_overrides_group"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "attendance_lesson_overrides"`);
  }
}
