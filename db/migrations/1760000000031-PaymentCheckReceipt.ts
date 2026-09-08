import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentCheckReceipt1760000000031 implements MigrationInterface {
  name = 'PaymentCheckReceipt1760000000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Payment: bazaviy chek/invoice raqami (center ichida ketma-ket).
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "invoiceNo" integer`,
    );

    // PaymentReceipt: chek maydonlari.
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "invoiceNo" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "installmentIndex" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "checkNo" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "balanceBefore" numeric(14,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "balanceAfter" numeric(14,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "paidAt" date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "paidAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "balanceAfter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "balanceBefore"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "checkNo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "installmentIndex"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "invoiceNo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN IF EXISTS "invoiceNo"`,
    );
  }
}
