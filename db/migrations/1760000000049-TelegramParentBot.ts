import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OTA-ONALAR UCHUN TELEGRAM BOT.
 *
 * Uchta jadval:
 *  - `telegram_link_tokens` — o'quvchining QR kodidagi maxfiy kalit. QR ichida
 *    `studentId` turmaydi (aks holda begona odam `?start=123` yozib istalgan
 *    o'quvchiga ulanardi), balki tasodifiy token turadi. Har o'quvchiga bitta.
 *  - `telegram_parent_links` — QR ni skaner qilgan chat ↔ o'quvchi. Bitta
 *    o'quvchiga bir nechta ota-ona ulanishi mumkin. Uzilgan ulanish o'chmaydi,
 *    `isActive = false` bo'ladi.
 *  - `telegram_bot_settings` — tashkilot darajasidagi sozlama: qaysi hodisada
 *    xabar ketadi. To'lov xabari default YOQILGAN, davomat va qarz eslatmasi
 *    default O'CHIQ.
 *
 * Bot tokeni DB'da emas, `TELEGRAM_BOT_TOKEN` env'ida — bitta umumiy bot
 * barcha tashkilotlarga xizmat qiladi, tashkilot esa token orqali aniqlanadi.
 */
export class TelegramParentBot1760000000049 implements MigrationInterface {
  name = 'TelegramParentBot1760000000049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "telegram_link_tokens" (
        "id" SERIAL PRIMARY KEY,
        "studentId" integer NOT NULL,
        "token" character varying(64) NOT NULL,
        "rotatedById" integer,
        "rotatedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tlt_student" UNIQUE ("studentId"),
        CONSTRAINT "UQ_tlt_token" UNIQUE ("token"),
        CONSTRAINT "FK_tlt_student" FOREIGN KEY ("studentId")
          REFERENCES "students"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "telegram_parent_links" (
        "id" SERIAL PRIMARY KEY,
        "studentId" integer NOT NULL,
        "chatId" character varying(32) NOT NULL,
        "telegramUserId" character varying(64),
        "firstName" character varying(128),
        "lastName" character varying(128),
        "username" character varying(64),
        "languageCode" character varying(8),
        "isActive" boolean NOT NULL DEFAULT true,
        "linkedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "unlinkedAt" TIMESTAMP,
        "blockedAt" TIMESTAMP,
        "lastNotifiedAt" TIMESTAMP,
        CONSTRAINT "FK_tpl_student" FOREIGN KEY ("studentId")
          REFERENCES "students"("id") ON DELETE CASCADE
      )
    `);

    // Bir chat bitta o'quvchiga faqat bir marta ulanadi (qayta skaner qilsa
    // yangi qator emas, mavjudi qayta faollashadi).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tpl_student_chat"
        ON "telegram_parent_links" ("studentId", "chatId")
    `);

    // Xabar yuborishda "shu o'quvchining faol chatlari" so'rovi uchun.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tpl_student_active"
        ON "telegram_parent_links" ("studentId", "isActive")
    `);

    // Bot bilan suhbat boshlanganda chat bo'yicha qidiriladi (/stop, /status).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tpl_chat"
        ON "telegram_parent_links" ("chatId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "telegram_bot_settings" (
        "id" SERIAL PRIMARY KEY,
        "organizationId" integer NOT NULL,
        "isEnabled" boolean NOT NULL DEFAULT true,
        "notifyPaymentReceived" boolean NOT NULL DEFAULT true,
        "notifyPaymentConfirmed" boolean NOT NULL DEFAULT false,
        "notifyAbsence" boolean NOT NULL DEFAULT false,
        "notifyDebt" boolean NOT NULL DEFAULT false,
        "debtReminderDay" integer NOT NULL DEFAULT 10,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tbs_organization" UNIQUE ("organizationId"),
        CONSTRAINT "FK_tbs_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    // Mavjud tashkilotlarga default sozlama — qator yo'qligida ham kod
    // default bilan ishlaydi, lekin sozlamalar sahifasi bo'sh ko'rinmasin.
    await queryRunner.query(`
      INSERT INTO "telegram_bot_settings" ("organizationId")
      SELECT "id" FROM "organizations"
      ON CONFLICT ("organizationId") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "telegram_bot_settings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tpl_chat"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tpl_student_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tpl_student_chat"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "telegram_parent_links"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "telegram_link_tokens"`);
  }
}
