import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guruh o'qituvchisining tarixi (kun aniqligida).
 *
 * Muammo: komissiya `payments → groups.teacher` orqali hisoblanardi, ya'ni
 * HOZIRGI o'qituvchi bo'yicha. O'qituvchi almashsa, butun oy (va qayta
 * hisoblanganda o'tgan oylar ham) yangi o'qituvchiga o'tib ketardi, eskisi
 * esa ishlagan darslari uchun pulini yo'qotardi.
 *
 * Backfill: har bir guruh uchun bitta davr — hozirgi o'qituvchi, guruh
 * boshlangan (yoki yaratilgan) kundan. Migratsiyadan keyin hisob o'zgarmaydi.
 */
export class GroupTeacherPeriods1760000000058 implements MigrationInterface {
  name = 'GroupTeacherPeriods1760000000058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "group_teacher_periods" (
        "id" SERIAL NOT NULL,
        "groupId" integer NOT NULL,
        "teacherId" integer,
        "fromDate" date NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_teacher_periods" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_group_teacher_periods_group_date"
        ON "group_teacher_periods" ("groupId", "fromDate")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_group_teacher_periods_teacher"
        ON "group_teacher_periods" ("teacherId")
    `);

    await queryRunner.query(`
      ALTER TABLE "group_teacher_periods"
      DROP CONSTRAINT IF EXISTS "FK_group_teacher_periods_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_teacher_periods"
      ADD CONSTRAINT "FK_group_teacher_periods_group"
      FOREIGN KEY ("groupId") REFERENCES "groups"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "group_teacher_periods"
      DROP CONSTRAINT IF EXISTS "FK_group_teacher_periods_teacher"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_teacher_periods"
      ADD CONSTRAINT "FK_group_teacher_periods_teacher"
      FOREIGN KEY ("teacherId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      INSERT INTO "group_teacher_periods" ("groupId", "teacherId", "fromDate")
      SELECT g."id", g."teacherId", LEAST(g."startDate", g."createdAt"::date)
        FROM "groups" g
      ON CONFLICT ("groupId", "fromDate") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "group_teacher_periods"`);
  }
}
