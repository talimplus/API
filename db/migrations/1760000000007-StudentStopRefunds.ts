import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentStopRefunds1760000000007 implements MigrationInterface {
  name = 'StudentStopRefunds1760000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "students"
      ADD COLUMN IF NOT EXISTS "stoppedAt" TIMESTAMP
    `);

    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "refundedAmount" numeric(14,2) NOT NULL DEFAULT '0'
    `);

    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments" DROP COLUMN IF EXISTS "refundedAt"
    `);
    await queryRunner.query(`
      ALTER TABLE "payments" DROP COLUMN IF EXISTS "refundedAmount"
    `);
    await queryRunner.query(`
      ALTER TABLE "students" DROP COLUMN IF EXISTS "stoppedAt"
    `);
  }
}

