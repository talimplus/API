import { MigrationInterface, QueryRunner } from 'typeorm';

export class GroupLifecycle1760000000015 implements MigrationInterface {
  name = 'GroupLifecycle1760000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add lifecycle fields
    await queryRunner.query(
      `ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "durationMonths" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "startedAt" timestamp`,
    );

    // Replace enum values for group status: active/inactive/completed -> new/started/finished
    // Keep enum name "groups_status_enum" for compatibility with existing schema.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'groups_status_enum') THEN
          ALTER TYPE "public"."groups_status_enum" RENAME TO "groups_status_enum_old";
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."groups_status_enum" AS ENUM ('new','started','finished');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='groups' AND column_name='status'
        ) THEN
          ALTER TABLE "groups" ALTER COLUMN "status" DROP DEFAULT;
          ALTER TABLE "groups"
            ALTER COLUMN "status"
            TYPE "public"."groups_status_enum"
            USING (
              CASE "status"::text
                WHEN 'active' THEN 'started'
                WHEN 'inactive' THEN 'new'
                WHEN 'completed' THEN 'finished'
                ELSE 'new'
              END
            )::"public"."groups_status_enum";
          ALTER TABLE "groups" ALTER COLUMN "status" SET DEFAULT 'new';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'groups_status_enum_old') THEN
          DROP TYPE "public"."groups_status_enum_old";
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate old enum and map values back.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'groups_status_enum') THEN
          ALTER TYPE "public"."groups_status_enum" RENAME TO "groups_status_enum_v2";
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."groups_status_enum" AS ENUM ('active','inactive','completed');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='groups' AND column_name='status'
        ) THEN
          ALTER TABLE "groups" ALTER COLUMN "status" DROP DEFAULT;
          ALTER TABLE "groups"
            ALTER COLUMN "status"
            TYPE "public"."groups_status_enum"
            USING (
              CASE "status"::text
                WHEN 'started' THEN 'active'
                WHEN 'new' THEN 'inactive'
                WHEN 'finished' THEN 'completed'
                ELSE 'inactive'
              END
            )::"public"."groups_status_enum";
          ALTER TABLE "groups" ALTER COLUMN "status" SET DEFAULT 'active';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'groups_status_enum_v2') THEN
          DROP TYPE "public"."groups_status_enum_v2";
        END IF;
      END $$;
    `);

    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN IF EXISTS "startedAt"`);
    await queryRunner.query(
      `ALTER TABLE "groups" DROP COLUMN IF EXISTS "durationMonths"`,
    );
  }
}

