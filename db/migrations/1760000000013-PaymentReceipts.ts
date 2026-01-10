import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentReceipts1760000000013 implements MigrationInterface {
  name = 'PaymentReceipts1760000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres does NOT support CREATE TYPE IF NOT EXISTS (in many versions),
    // so we use a DO block.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'payment_receipts_status_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."payment_receipts_status_enum" AS ENUM ('pending','confirmed','rejected');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_receipts" (
        "id" SERIAL NOT NULL,
        "paymentId" integer NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "receivedById" integer,
        "receivedAt" TIMESTAMP,
        "confirmedById" integer,
        "confirmedAt" TIMESTAMP,
        "status" "public"."payment_receipts_status_enum" NOT NULL DEFAULT 'pending',
        "comment" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_receipts_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_receipts_payment_status" ON "payment_receipts" ("paymentId","status")`,
    );

    // Postgres does NOT support ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_payment_receipts_payment') THEN
          ALTER TABLE "payment_receipts"
            ADD CONSTRAINT "FK_payment_receipts_payment"
            FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_payment_receipts_received_by') THEN
          ALTER TABLE "payment_receipts"
            ADD CONSTRAINT "FK_payment_receipts_received_by"
            FOREIGN KEY ("receivedById") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_payment_receipts_confirmed_by') THEN
          ALTER TABLE "payment_receipts"
            ADD CONSTRAINT "FK_payment_receipts_confirmed_by"
            FOREIGN KEY ("confirmedById") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP CONSTRAINT IF EXISTS "FK_payment_receipts_confirmed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP CONSTRAINT IF EXISTS "FK_payment_receipts_received_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_receipts" DROP CONSTRAINT IF EXISTS "FK_payment_receipts_payment"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_payment_receipts_payment_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_receipts"`);
    // keep enum type (safe no-op) – optional:
    // await queryRunner.query(`DROP TYPE IF EXISTS "public"."payment_receipts_status_enum"`);
  }
}

