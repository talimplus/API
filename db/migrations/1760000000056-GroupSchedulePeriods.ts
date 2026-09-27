import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guruh dars jadvalining tarixi (kun aniqligida).
 *
 * Muammo: jadval (`group_schedule`) o'zgartirilganda eski qatorlar o'chirilib
 * yangisi yozilardi. Natijada o'tgan oylar ham yangi jadval bo'yicha
 * hisoblanardi: eski kunlardagi davomat jurnaldan yo'qolardi, unga tuzatish
 * kiritib bo'lmasdi, ochiq to'lovlar proratsiyasi esa o'zgarib ketardi.
 *
 * Backfill: jadvali bor har bir guruh uchun bitta davr — hozirgi jadval,
 * guruh boshlangan (yoki yaratilgan) kundan boshlab. Tarixni tiklab
 * bo'lmaydi, shuning uchun migratsiyadan keyin hisob-kitob o'zgarmaydi.
 */
export class GroupSchedulePeriods1760000000056 implements MigrationInterface {
  name = 'GroupSchedulePeriods1760000000056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "group_schedule_periods" (
        "id" SERIAL NOT NULL,
        "groupId" integer NOT NULL,
        "fromDate" date NOT NULL,
        "days" jsonb NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_schedule_periods" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_group_schedule_periods_group_date"
        ON "group_schedule_periods" ("groupId", "fromDate")
    `);

    await queryRunner.query(`
      ALTER TABLE "group_schedule_periods"
      DROP CONSTRAINT IF EXISTS "FK_group_schedule_periods_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_schedule_periods"
      ADD CONSTRAINT "FK_group_schedule_periods_group"
      FOREIGN KEY ("groupId") REFERENCES "groups"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      INSERT INTO "group_schedule_periods" ("groupId", "fromDate", "days")
      SELECT g."id",
             LEAST(g."startDate", g."createdAt"::date),
             jsonb_agg(
               jsonb_build_object('day', s."day", 'startTime', s."startTime"::text)
               ORDER BY s."id"
             )
        FROM "groups" g
        JOIN "group_schedule" s ON s."groupId" = g."id"
       GROUP BY g."id"
      ON CONFLICT ("groupId", "fromDate") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "group_schedule_periods"`);
  }
}
