import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentPlannedStudyUntilDate1760000000022
  implements MigrationInterface
{
  name = 'PaymentPlannedStudyUntilDate1760000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "plannedStudyUntilDate" date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN IF EXISTS "plannedStudyUntilDate"`,
    );
  }
}
