import { MigrationInterface, QueryRunner } from 'typeorm';

export class DiscountPeriodsExclusiveToMonth1760000000009
  implements MigrationInterface
{
  name = 'DiscountPeriodsExclusiveToMonth1760000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Convert existing inclusive toMonth semantics -> exclusive end boundary:
    // [fromMonth .. toMonth]  ==>  [fromMonth .. (toMonth + 1 month))
    await queryRunner.query(`
      UPDATE "student_discount_periods"
      SET "toMonth" = ("toMonth" + interval '1 month')::date
      WHERE "toMonth" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort rollback (exclusive -> inclusive)
    await queryRunner.query(`
      UPDATE "student_discount_periods"
      SET "toMonth" = ("toMonth" - interval '1 month')::date
      WHERE "toMonth" IS NOT NULL
    `);
  }
}

