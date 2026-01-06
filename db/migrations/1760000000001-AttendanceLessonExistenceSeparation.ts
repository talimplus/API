import { MigrationInterface, QueryRunner } from 'typeorm';

export class AttendanceLessonExistenceSeparation1760000000001
  implements MigrationInterface
{
  name = 'AttendanceLessonExistenceSeparation1760000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- groups: add schedule boundaries + timezone + status (needed for schedule-driven lesson existence)
    await queryRunner.query(
      `CREATE TYPE "public"."groups_status_enum" AS ENUM('active', 'inactive', 'completed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ADD "timezone" character varying NOT NULL DEFAULT 'Asia/Tashkent'`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ADD "startDate" date NOT NULL DEFAULT CURRENT_DATE`,
    );
    await queryRunner.query(`ALTER TABLE "groups" ADD "endDate" date`);
    await queryRunner.query(
      `ALTER TABLE "groups" ADD "status" "public"."groups_status_enum" NOT NULL DEFAULT 'active'`,
    );

    // ---- attendance: persisted facts only, keyed by (groupId, studentId, lessonDate)
    await queryRunner.query(
      `CREATE TYPE "public"."attendance_status_enum" AS ENUM('present', 'absent', 'late', 'excused')`,
    );

    // Rename date -> lessonDate (DATE in group timezone)
    await queryRunner.query(
      `ALTER TABLE "attendance" RENAME COLUMN "date" TO "lessonDate"`,
    );

    // Rename reason -> comment
    await queryRunner.query(
      `ALTER TABLE "attendance" RENAME COLUMN "reason" TO "comment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" ALTER COLUMN "comment" TYPE text`,
    );

    // status + audit columns
    await queryRunner.query(
      `ALTER TABLE "attendance" ADD "status" "public"."attendance_status_enum" NOT NULL DEFAULT 'present'`,
    );
    await queryRunner.query(
      `UPDATE "attendance" SET "status" = CASE WHEN "isPresent" = true THEN 'present' ELSE 'absent' END`,
    );
    await queryRunner.query(`ALTER TABLE "attendance" DROP COLUMN "isPresent"`);

    await queryRunner.query(
      `ALTER TABLE "attendance" ADD "submittedById" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" ADD "submittedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );

    await queryRunner.query(
      `ALTER TABLE "attendance" ALTER COLUMN "studentId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance" ALTER COLUMN "groupId" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "attendance" ADD CONSTRAINT "UQ_attendance_group_student_lessonDate" UNIQUE ("groupId", "studentId", "lessonDate")`,
    );

    await queryRunner.query(
      `ALTER TABLE "attendance" ADD CONSTRAINT "FK_attendance_submitted_by" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
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


