import { MigrationInterface, QueryRunner } from 'typeorm';

export class CentersIsDefault1760000000010 implements MigrationInterface {
  name = 'CentersIsDefault1760000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // add column (idempotent)
    await queryRunner.query(
      `ALTER TABLE "centers" ADD COLUMN IF NOT EXISTS "isDefault" boolean NOT NULL DEFAULT false`,
    );

    // ensure one default per organization (choose earliest created center)
    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          c."id" as "id",
          c."organizationId" as "organizationId",
          ROW_NUMBER() OVER (PARTITION BY c."organizationId" ORDER BY c."createdAt" ASC, c."id" ASC) AS rn
        FROM "centers" c
        WHERE c."organizationId" IS NOT NULL
      )
      UPDATE "centers" c
      SET "isDefault" = true
      FROM ranked r
      WHERE c."id" = r."id"
        AND r.rn = 1
        AND NOT EXISTS (
          SELECT 1 FROM "centers" c2
          WHERE c2."organizationId" = r."organizationId"
            AND c2."isDefault" = true
        )
    `);

    // enforce at DB level: only one default center per organization
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_centers_organization_default" ON "centers" ("organizationId") WHERE "isDefault" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_centers_organization_default"`,
    );
    await queryRunner.query(
      `ALTER TABLE "centers" DROP COLUMN IF EXISTS "isDefault"`,
    );
  }
}

