import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PaymentReceipt uchun global yagona tranzaktsiya raqami (transactionNo).
 * Format: TRX-YYYYMMDD-NNNNNN. Ketma-ket raqam butun tizim bo'yicha yagona
 * sequence'dan (payment_receipt_transaction_seq) olinadi — nextval atomar
 * bo'lgani uchun parallel to'lovlarda ham takrorlanmaydi.
 */
export class PaymentTransactionNo1760000000034 implements MigrationInterface {
  name = 'PaymentTransactionNo1760000000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Global ketma-ket raqam manbai.
    await queryRunner.query(
      `CREATE SEQUENCE IF NOT EXISTS "payment_receipt_transaction_seq" START WITH 1 INCREMENT BY 1`,
    );

    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "transactionNo" character varying(32)`,
    );

    // Yagona (unique) — bir tranzaktsiya raqami faqat bitta receiptga tegishli.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_receipts_transactionNo" ON "payment_receipts" ("transactionNo")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_payment_receipts_transactionNo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "transactionNo"`,
    );
    await queryRunner.query(
      `DROP SEQUENCE IF EXISTS "payment_receipt_transaction_seq"`,
    );
  }
}
