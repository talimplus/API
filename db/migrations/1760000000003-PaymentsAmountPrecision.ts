import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentsAmountPrecision1760000000003 implements MigrationInterface {
  name = 'PaymentsAmountPrecision1760000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Widen numeric precision to prevent "numeric field overflow"
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "amountDue" TYPE numeric(14,2) USING "amountDue"::numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "amountPaid" TYPE numeric(14,2) USING "amountPaid"::numeric`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "amountPaid" TYPE numeric(10,2) USING "amountPaid"::numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "amountDue" TYPE numeric(10,2) USING "amountDue"::numeric`,
    );
  }
}


