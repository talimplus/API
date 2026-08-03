import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentLessonsExcused1760000000028 implements MigrationInterface {
  name = 'PaymentLessonsExcused1760000000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "lessonsExcused" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN IF EXISTS "lessonsExcused"`,
    );
  }
}
