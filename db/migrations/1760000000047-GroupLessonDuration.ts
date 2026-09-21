import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DARS DAVOMIYLIGI (`groups.lessonDurationMinutes`).
 *
 * Muammo: jadvalda faqat dars **boshlanish** vaqti bor edi
 * (`group_schedule.startTime`), davomiylik esa hech qayerda saqlanmasdi.
 * Shuning uchun xona bandligi faqat vaqt **aynan teng** bo'lganda aniqlanardi:
 * 14:00 da boshlanadigan dars ustiga 14:30 dagi ikkinchi guruhni bemalol
 * yozib yuborish mumkin edi.
 *
 * Yechim: davomiylik guruh darajasida saqlanadi (bitta guruhning barcha
 * darslari bir xil uzunlikda). Shu bilan:
 *  - xona va o'qituvchi bandligi haqiqiy vaqt kesishishi bo'yicha tekshiriladi;
 *  - dars jadvali sahifasida darslar blok bo'lib ko'rinadi.
 *
 * Mavjud guruhlar uchun default 90 daqiqa — eng keng tarqalgan dars uzunligi.
 * Admin keyin har bir guruhda o'zgartirishi mumkin.
 */
export class GroupLessonDuration1760000000047 implements MigrationInterface {
  name = 'GroupLessonDuration1760000000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "groups"
        ADD COLUMN IF NOT EXISTS "lessonDurationMinutes" integer NOT NULL DEFAULT 90
    `);

    // Eski yozuvlarda NULL bo'lib qolgan bo'lsa (ustun qo'lda qo'shilgan holat)
    await queryRunner.query(`
      UPDATE "groups"
         SET "lessonDurationMinutes" = 90
       WHERE "lessonDurationMinutes" IS NULL OR "lessonDurationMinutes" <= 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "groups" DROP COLUMN IF EXISTS "lessonDurationMinutes"
    `);
  }
}
