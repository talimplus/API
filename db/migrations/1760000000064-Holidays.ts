import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bayram / dam olish kunlari (`holidays`).
 *
 * Bu kunlarda hech bir guruhda dars bo'lmaydi. Ilgari buning yo'li yo'q edi:
 * har bir guruhda darsni qo'lda boshqa kunga ko'chirish kerak edi.
 */
export class Holidays1760000000064 implements MigrationInterface {
  name = 'Holidays1760000000064';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "holidays" (
        "id" SERIAL NOT NULL,
        "organizationId" integer NOT NULL,
        "centerId" integer,
        "fromDate" date NOT NULL,
        "toDate" date NOT NULL,
        "name" text NOT NULL,
        "createdById" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_holidays" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_holidays_range" CHECK ("toDate" >= "fromDate")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_holidays_org_from"
        ON "holidays" ("organizationId", "fromDate")
    `);
    for (const [name, col, ref, onDelete] of [
      [
        'FK_holidays_organization',
        'organizationId',
        'organizations',
        'CASCADE',
      ],
      ['FK_holidays_center', 'centerId', 'centers', 'CASCADE'],
      ['FK_holidays_created_by', 'createdById', 'users', 'SET NULL'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "holidays" DROP CONSTRAINT IF EXISTS "${name}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "holidays" ADD CONSTRAINT "${name}"
         FOREIGN KEY ("${col}") REFERENCES "${ref}"("id")
         ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "holidays"`);
  }
}
