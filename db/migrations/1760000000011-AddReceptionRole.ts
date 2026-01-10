import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceptionRole1760000000011 implements MigrationInterface {
  name = 'AddReceptionRole1760000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres enum: add value (idempotent)
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'reception'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot easily remove enum values safely; no-op.
  }
}

