import { MigrationInterface, QueryRunner } from 'typeorm';

export class BlacklistedTokens1760000000012 implements MigrationInterface {
  name = 'BlacklistedTokens1760000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "blacklisted_tokens" (
        "id" SERIAL NOT NULL,
        "tokenHash" character varying(64) NOT NULL,
        "userId" integer,
        "expiresAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_blacklisted_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_blacklisted_tokens_tokenHash" UNIQUE ("tokenHash")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "blacklisted_tokens"`);
  }
}

