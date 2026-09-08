import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentStudyDays1760000000029 implements MigrationInterface {
  name = 'StudentStudyDays1760000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "studyDays" text[]`,
    );

    // Backfill: mavjud o'quvchilarga biriktirilgan guruh(lar)ning dars
    // kunlarini (union, hafta tartibida) yozib qo'yamiz.
    await queryRunner.query(`
      UPDATE "students" s
      SET "studyDays" = sub.days
      FROM (
        SELECT student_id, array_agg(day ORDER BY ord) AS days
        FROM (
          SELECT DISTINCT
            sg."studentsId" AS student_id,
            gs."day"::text AS day,
            CASE gs."day"::text
              WHEN 'monday' THEN 1
              WHEN 'tuesday' THEN 2
              WHEN 'wednesday' THEN 3
              WHEN 'thursday' THEN 4
              WHEN 'friday' THEN 5
              WHEN 'saturday' THEN 6
              WHEN 'sunday' THEN 7
            END AS ord
          FROM "students_groups_groups" sg
          JOIN "group_schedule" gs ON gs."groupId" = sg."groupsId"
        ) d
        GROUP BY student_id
      ) sub
      WHERE s."id" = sub.student_id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN IF EXISTS "studyDays"`,
    );
  }
}
