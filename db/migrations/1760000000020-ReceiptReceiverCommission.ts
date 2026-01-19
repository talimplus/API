import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReceiptReceiverCommission1760000000020
  implements MigrationInterface
{
  name = 'ReceiptReceiverCommission1760000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "receiverCommissionPercentSnapshot" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "receiverCommissionAmountSnapshot" numeric(14,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "receiverCommissionAmountSnapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "receiverCommissionPercentSnapshot"`,
    );
  }
}

