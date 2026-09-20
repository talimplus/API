import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "group_extensions" -> "group_end_date_changes" qayta nomlash.
 *
 * Nega kerak: guruh tugash sanasi faqat uzaytirilmaydi, uni oldinga surish
 * (erta tugatish) ham mumkin. Shuning uchun jadval va ustun nomlari
 * "uzaytirish" emas, "tugash sanasi o'zgarishi" ma'nosiga keltirildi:
 *   group_extensions  -> group_end_date_changes
 *   extendedById      -> changedById
 *
 * Mavjud yozuvlar saqlanadi. Jadval hali yaratilmagan muhitlarda
 * (1760000000036 ishlamagan bo'lsa) u shu yerda yangi nomi bilan yaratiladi.
 */
export class GroupEndDateChanges1760000000037 implements MigrationInterface {
  name = 'GroupEndDateChanges1760000000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Eski nomdagi jadval/ustun/PK bo'lsa — qayta nomlaymiz.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'group_extensions'
        ) THEN
          ALTER TABLE "group_extensions" RENAME TO "group_end_date_changes";
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'group_end_date_changes'
            AND column_name = 'extendedById'
        ) THEN
          ALTER TABLE "group_end_date_changes"
            RENAME COLUMN "extendedById" TO "changedById";
        END IF;

        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'PK_group_extensions'
        ) THEN
          ALTER TABLE "group_end_date_changes"
            RENAME CONSTRAINT "PK_group_extensions" TO "PK_group_end_date_changes";
        END IF;
      END $$;
    `);

    // 2) Eski nomli index va FK'lar (ular qayta nomlashdan keyin ham qoladi).
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_group_extensions_groupId"`,
    );
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "group_end_date_changes"
      DROP CONSTRAINT IF EXISTS "FK_group_extensions_group"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "group_end_date_changes"
      DROP CONSTRAINT IF EXISTS "FK_group_extensions_extendedBy"
    `);

    // 3) Jadval umuman bo'lmasa — yangi nomi bilan yaratamiz.
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

    // 4) Yangi nomdagi index va FK'lar.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_group_end_date_changes_groupId"
        ON "group_end_date_changes" ("groupId")
    `);
    await queryRunner.query(`
      ALTER TABLE "group_end_date_changes"
      DROP CONSTRAINT IF EXISTS "FK_group_end_date_changes_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_end_date_changes"
      ADD CONSTRAINT "FK_group_end_date_changes_group"
      FOREIGN KEY ("groupId") REFERENCES "groups"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "group_end_date_changes"
      DROP CONSTRAINT IF EXISTS "FK_group_end_date_changes_changedBy"
    `);
    await queryRunner.query(`
      ALTER TABLE "group_end_date_changes"
      ADD CONSTRAINT "FK_group_end_date_changes_changedBy"
      FOREIGN KEY ("changedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Eski nomlarga qaytaramiz (1760000000036 down'i ishlashi uchun).
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_group_end_date_changes_groupId"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "group_end_date_changes"
      DROP CONSTRAINT IF EXISTS "FK_group_end_date_changes_group"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "group_end_date_changes"
      DROP CONSTRAINT IF EXISTS "FK_group_end_date_changes_changedBy"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = 'group_end_date_changes'
        ) THEN
          IF EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'PK_group_end_date_changes'
          ) THEN
            ALTER TABLE "group_end_date_changes"
              RENAME CONSTRAINT "PK_group_end_date_changes" TO "PK_group_extensions";
          END IF;

          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'group_end_date_changes'
              AND column_name = 'changedById'
          ) THEN
            ALTER TABLE "group_end_date_changes"
              RENAME COLUMN "changedById" TO "extendedById";
          END IF;

          ALTER TABLE "group_end_date_changes" RENAME TO "group_extensions";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_group_extensions_groupId"
        ON "group_extensions" ("groupId")
    `);
    await queryRunner.query(`
      ALTER TABLE "group_extensions"
      ADD CONSTRAINT "FK_group_extensions_group"
      FOREIGN KEY ("groupId") REFERENCES "groups"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "group_extensions"
      ADD CONSTRAINT "FK_group_extensions_extendedBy"
      FOREIGN KEY ("extendedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }
}
