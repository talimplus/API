import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OYLIK — ISH OYI BO'YICHA.
 *
 * Ilgari `staff_salaries.forMonth` va `teacher_monthly_earnings.forMonth` TO'LOV
 * oyini saqlardi (iyun ishi → "Iyul" qatori). Bu chalg'itardi: iyun oyligi baribir
 * iyunniki. Endi oy — ISH oyi: pul keyingi oyda berilsa ham oylik o'z oyida
 * turadi (to'lanmagan bo'lib), joriy oy esa o'quvchilar to'lagan sari o'sib boradi.
 *
 * Mavjud qatorlar bir oy orqaga suriladi:
 * - `staff_salaries.forMonth`, `teacher_monthly_earnings.forMonth`,
 *   `teacher_commission_carryovers.appliedForMonth`.
 * - `teacher_commission_carryovers.sourceForMonth` allaqachon ish oyi edi — tegilmaydi.
 * - `staff_deductions.sourceForMonth` — jarima yozilgan oy, tegilmaydi (qo'llangan
 *   jarimalar `staff_salary_deductions` orqali aniq qatorga bog'langan).
 *
 * `(userId, forMonth)` unique bo'lgani uchun surish ikki bosqichda: avval
 * 1000 yil oldinga (to'qnashuvsiz), keyin kerakli joyga.
 */
export class SalaryWorkMonth1760000000053 implements MigrationInterface {
  name = 'SalaryWorkMonth1760000000053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.shift(queryRunner, "- interval '1 month'");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.shift(queryRunner, "+ interval '1 month'");
  }

  private async shift(queryRunner: QueryRunner, delta: string): Promise<void> {
    for (const table of ['staff_salaries', 'teacher_monthly_earnings']) {
      await queryRunner.query(
        `UPDATE "${table}" SET "forMonth" = ("forMonth" + interval '1000 years')::date`,
      );
      await queryRunner.query(
        `UPDATE "${table}" SET "forMonth" = ("forMonth" - interval '1000 years' ${delta})::date`,
      );
    }
    await queryRunner.query(
      `UPDATE "teacher_commission_carryovers"
          SET "appliedForMonth" = ("appliedForMonth" ${delta})::date
        WHERE "appliedForMonth" IS NOT NULL`,
    );
  }
}
