import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASHKILOT BRENDINGI (logo, favicon).
 *
 * SaaS: domen bitta (`talimplus`), lekin kabinetda har bir o'quv markazi
 * **o'z nomi va logotipini** ko'rishi kerak. Nomi allaqachon
 * `organizations.name` da — bu migratsiya faqat rasm maydonlarini qo'shadi.
 *
 * Rasm alohida fayl sifatida emas, **data URL** ko'rinishida `text` ustunda
 * saqlanadi. Sabab: loyihada hozircha fayl yuklash infratuzilmasi (disk,
 * S3, statik serving) umuman yo'q; logo va favicon esa kichkina va kamdan
 * kam o'zgaradi. Kelajakda fayl saqlash qo'shilsa, bu ustunlarga oddiy
 * `https://...` havolasini yozish ham mumkin — o'qiydigan kod ikkalasini
 * ham qabul qiladi.
 */
export class OrganizationBranding1760000000051 implements MigrationInterface {
  name = 'OrganizationBranding1760000000051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "logoUrl" text,
        ADD COLUMN IF NOT EXISTS "faviconUrl" text,
        ADD COLUMN IF NOT EXISTS "brandingUpdatedAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "brandingUpdatedAt",
        DROP COLUMN IF EXISTS "faviconUrl",
        DROP COLUMN IF EXISTS "logoUrl"
    `);
  }
}
