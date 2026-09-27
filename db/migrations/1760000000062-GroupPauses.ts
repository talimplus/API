import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guruhni vaqtincha to'xtatish (`group_pauses`).
 *
 * Ilgari guruhni vaqtincha to'xtatishning yo'li yo'q edi: tugash sanasini
 * o'zgartirish guruhni butunlay yopardi, dars ko'chirish esa faqat boshqa
 * kunga surardi. To'xtatilgan davrdagi darslar o'tkazilmaydi va to'lovga
 * kirmaydi.
 */
export class GroupPauses1760000000062 implements MigrationInterface {
  name = 'GroupPauses1760000000062';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "group_pauses" (
        "id" SERIAL NOT NULL,
        "groupId" integer NOT NULL,
        "fromDate" date NOT NULL,
        "toDate" date NOT NULL,
        "reason" text NOT NULL,
        "createdById" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_pauses" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_group_pauses_range" CHECK ("toDate" >= "fromDate")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_group_pauses_group_from"
        ON "group_pauses" ("groupId", "fromDate")
    `);
    await queryRunner.query(`
      ALTER TABLE "group_pauses"
      DROP CONSTRAINT IF EXISTS "FK_group_pauses_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_pauses"
      ADD CONSTRAINT "FK_group_pauses_group"
      FOREIGN KEY ("groupId") REFERENCES "groups"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "group_pauses"
      DROP CONSTRAINT IF EXISTS "FK_group_pauses_created_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_pauses"
      ADD CONSTRAINT "FK_group_pauses_created_by"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "group_pauses"`);
  }
}
