import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guruh tugash sanasi o'zgarishlari tarixi uchun jadval.
 *
 * DIQQAT: jadval keyinchalik 1760000000037 migratsiyasida
 * "group_end_date_changes" deb qayta nomlangan (sana faqat uzaytirilmay,
 * qisqartirilishi ham mumkin bo'lgani uchun). Bu migratsiya faqat tarix
 * uchun qoldirilgan — yangi kod "group_end_date_changes" bilan ishlaydi.
 */
export class GroupEndDateExtensions1760000000036 implements MigrationInterface {
  name = 'GroupEndDateExtensions1760000000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "group_extensions" (
        "id" SERIAL NOT NULL,
        "previousEndDate" date,
        "newEndDate" date NOT NULL,
        "reason" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "groupId" integer,
        "extendedById" integer,
        CONSTRAINT "PK_group_extensions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_group_extensions_groupId"
        ON "group_extensions" ("groupId")
    `);

    await queryRunner.query(`
      ALTER TABLE "group_extensions"
      DROP CONSTRAINT IF EXISTS "FK_group_extensions_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_extensions"
      ADD CONSTRAINT "FK_group_extensions_group"
      FOREIGN KEY ("groupId") REFERENCES "groups"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "group_extensions"
      DROP CONSTRAINT IF EXISTS "FK_group_extensions_extendedBy"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_extensions"
      ADD CONSTRAINT "FK_group_extensions_extendedBy"
      FOREIGN KEY ("extendedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "group_extensions"`);
  }
}
