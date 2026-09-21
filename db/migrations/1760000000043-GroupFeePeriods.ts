import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guruh narxi tarixi (oy aniqligida).
 *
 * Maqsad: narx oy o'rtasida o'zgartirilganda o'tgan va joriy oy to'lovlari
 * qayta narxlanmasligi. Yangi narx keyingi oydan kuchga kiradi.
 *
 * Backfill: har bir mavjud guruh uchun bitta qator yoziladi — hozirgi narx,
 * guruh boshlangan (yoki yaratilgan) oydan boshlab. Shu sabab migratsiyadan
 * keyin hisob-kitob o'zgarmaydi.
 */
export class GroupFeePeriods1760000000043 implements MigrationInterface {
  name = 'GroupFeePeriods1760000000043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "group_fee_periods" (
        "id" SERIAL NOT NULL,
        "groupId" integer NOT NULL,
        "fromMonth" date NOT NULL,
        "monthlyFee" numeric NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_fee_periods" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_group_fee_periods_group_month"
        ON "group_fee_periods" ("groupId", "fromMonth")
    `);

    await queryRunner.query(`
      ALTER TABLE "group_fee_periods"
      DROP CONSTRAINT IF EXISTS "FK_group_fee_periods_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_fee_periods"
      ADD CONSTRAINT "FK_group_fee_periods_group"
      FOREIGN KEY ("groupId") REFERENCES "groups"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // Mavjud guruhlar uchun boshlang'ich narx davri.
    await queryRunner.query(`
      INSERT INTO "group_fee_periods" ("groupId", "fromMonth", "monthlyFee")
      SELECT g."id",
             LEAST(
               DATE_TRUNC('month', g."startDate")::date,
               DATE_TRUNC('month', g."createdAt")::date
             ),
             COALESCE(g."monthlyFee", 0)
        FROM "groups" g
      ON CONFLICT ("groupId", "fromMonth") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "group_fee_periods"`);
  }
}
