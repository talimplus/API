import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentReceiptPaymentMethod1760000000026
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "payment_method_enum" AS ENUM('cash', 'card', 'bank_transfer', 'online')`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" ADD "paymentMethod" "payment_method_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP COLUMN "paymentMethod"`,
    );
    await queryRunner.query(`DROP TYPE "payment_method_enum"`);
  }
}
