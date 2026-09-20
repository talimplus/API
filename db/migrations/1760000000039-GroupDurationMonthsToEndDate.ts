import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * groups."durationMonths" (necha oy) ustunini olib tashlaymiz — o'rniga
 * yagona manba sifatida groups."endDate" (darslar tugash sanasi) ishlatiladi.
 *
 * Nega kerak edi: "necha oy" faqat guruh statusini avtomatik yopish uchun
 * ishlatilardi, darslar ro'yxati va to'lov hisob-kitobi esa faqat endDate'ga
 * qarardi. Natijada endDate bo'sh guruhlarda to'lov cheksiz hisoblanaverardi.
 *
 * Backfill: endDate bo'sh, lekin durationMonths bor guruhlarga
 *   endDate = (startedAt yoki startDate) + durationMonths oy - 1 kun
 * yoziladi (inclusive chegara). Bu eski avtomatik yopilish sanasi bilan
 * bir xil kunga to'g'ri keladi, ya'ni mavjud guruhlar muddati o'zgarmaydi.
 */
export class GroupDurationMonthsToEndDate1760000000039
  implements MigrationInterface
{
  name = 'GroupDurationMonthsToEndDate1760000000039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "groups"
      SET "endDate" = (
        (COALESCE("startedAt"::date, "startDate")
          + ("durationMonths" || ' months')::interval
          - INTERVAL '1 day')
      )::date
      WHERE "endDate" IS NULL
        AND "durationMonths" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "groups" DROP COLUMN IF EXISTS "durationMonths"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Ustun qaytariladi, lekin qiymatlar tiklanmaydi: muddat endi endDate
    // orqali saqlanadi.
    await queryRunner.query(
      `ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "durationMonths" integer`,
    );
  }
}
