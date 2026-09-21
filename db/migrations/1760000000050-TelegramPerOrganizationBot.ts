import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HAR TASHKILOTGA O'Z BOTI.
 *
 * Avval bitta umumiy bot (`TELEGRAM_BOT_TOKEN` env) rejalashtirilgandi, lekin
 * loyiha SaaS: har bir o'quv markazi ota-onaga **o'z nomi bilan** yozishi
 * kerak. Shuning uchun token endi env'da emas, `telegram_bot_settings.botToken`
 * da — markaz @BotFather'dan o'z botini ochib, tokenini sozlamalarga kiritadi.
 *
 * `botUsername` qo'lda yozilmaydi: token saqlanayotganda `getMe()` chaqirilib
 * avtomatik to'ldiriladi (username bilan xabar yuborib bo'lmaydi, token kerak).
 *
 * `telegram_parent_links.organizationId` — denormalizatsiya: bot xabar
 * qabul qilganda "bu chat shu tashkilotnikimi" degan savol har safar
 * student → center → organization zanjirisiz hal bo'lishi uchun. Bu chegara
 * muhim: A markazning QR kodi B markazning botiga ulanmasligi kerak.
 */
export class TelegramPerOrganizationBot1760000000050
  implements MigrationInterface
{
  name = 'TelegramPerOrganizationBot1760000000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "telegram_bot_settings"
        ADD COLUMN IF NOT EXISTS "botToken" character varying(128),
        ADD COLUMN IF NOT EXISTS "botUsername" character varying(64),
        ADD COLUMN IF NOT EXISTS "botTokenUpdatedAt" TIMESTAMP
    `);

    // Bitta token ikkita tashkilotga biriktirilsa Telegram 409 beradi
    // (bir tokenga bitta polling). Bazada ham to'sib qo'yamiz.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tbs_bot_token"
        ON "telegram_bot_settings" ("botToken")
        WHERE "botToken" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "telegram_parent_links"
        ADD COLUMN IF NOT EXISTS "organizationId" integer
    `);

    await queryRunner.query(`
      UPDATE "telegram_parent_links" l
      SET "organizationId" = c."organizationId"
      FROM "students" s
      JOIN "centers" c ON c."id" = s."centerId"
      WHERE s."id" = l."studentId" AND l."organizationId" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tpl_org_chat"
        ON "telegram_parent_links" ("organizationId", "chatId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tpl_org_chat"`);
    await queryRunner.query(`
      ALTER TABLE "telegram_parent_links"
        DROP COLUMN IF EXISTS "organizationId"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tbs_bot_token"`);
    await queryRunner.query(`
      ALTER TABLE "telegram_bot_settings"
        DROP COLUMN IF EXISTS "botTokenUpdatedAt",
        DROP COLUMN IF EXISTS "botUsername",
        DROP COLUMN IF EXISTS "botToken"
    `);
  }
}
