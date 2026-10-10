import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Yangi o'quvchiga "birinchi N oy tekin" (`students.freeMonths`).
 *
 * Tekin davr o'quvchining birinchi darsi sanasidan (barcha guruhlari bo'yicha
 * eng ertasi) N kalendar oy: 17-oktabr + 1 oy → 17-noyabrgacha (exclusive).
 * Shu oraliqdagi darslar to'lovga kirmaydi; keyingisi odatdagidek proratsiya.
 * 0 — tekin davr yo'q (default).
 */
export class StudentFreeMonths1760000000069 implements MigrationInterface {
  name = 'StudentFreeMonths1760000000069';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "freeMonths" smallint NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN IF EXISTS "freeMonths"`,
    );
  }
}
