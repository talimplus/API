import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "group_end_date_changes" jadvalini olib tashlaymiz.
 *
 * Nega: guruh tugash sanasi uchun alohida API va tarix jadvali kerak emas —
 * sana oddiy `PUT /groups/:id` orqali o'zgartiriladi va yagona manba
 * groups."endDate" bo'lib qoladi.
 */
export class DropGroupEndDateChanges1760000000038
  implements MigrationInterface
{
  name = 'DropGroupEndDateChanges1760000000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "group_end_date_changes"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "group_end_date_changes" (
        "id" SERIAL NOT NULL,
        "previousEndDate" date,
        "newEndDate" date NOT NULL,
        "reason" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "groupId" integer,
        "changedById" integer,
        CONSTRAINT "PK_group_end_date_changes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_group_end_date_changes_groupId"
        ON "group_end_date_changes" ("groupId")
    `);
    await queryRunner.query(`
      ALTER TABLE "group_end_date_changes"
      ADD CONSTRAINT "FK_group_end_date_changes_group"
      FOREIGN KEY ("groupId") REFERENCES "groups"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "group_end_date_changes"
      ADD CONSTRAINT "FK_group_end_date_changes_changedBy"
      FOREIGN KEY ("changedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }
}
