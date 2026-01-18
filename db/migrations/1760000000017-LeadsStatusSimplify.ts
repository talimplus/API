import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadsStatusSimplify1760000000017 implements MigrationInterface {
  name = 'LeadsStatusSimplify1760000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Replace enum values for leads status to 3 states:
    // new / discarded / converted
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leads_status_enum') THEN
          ALTER TYPE "public"."leads_status_enum" RENAME TO "leads_status_enum_old";
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."leads_status_enum" AS ENUM ('new','discarded','converted');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='leads' AND column_name='status'
        ) THEN
          ALTER TABLE "leads" ALTER COLUMN "status" DROP DEFAULT;
          ALTER TABLE "leads"
            ALTER COLUMN "status"
            TYPE "public"."leads_status_enum"
            USING (
              CASE "status"::text
                WHEN 'converted' THEN 'converted'
                WHEN 'not_interested' THEN 'discarded'
                WHEN 'called' THEN 'new'
                WHEN 'interested' THEN 'new'
                WHEN 'no_answer' THEN 'new'
                WHEN 'new' THEN 'new'
                ELSE 'new'
              END
            )::"public"."leads_status_enum";
          ALTER TABLE "leads" ALTER COLUMN "status" SET DEFAULT 'new';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leads_status_enum_old') THEN
          DROP TYPE "public"."leads_status_enum_old";
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore old enum with more states (backward compatibility)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leads_status_enum') THEN
          ALTER TYPE "public"."leads_status_enum" RENAME TO "leads_status_enum_v2";
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."leads_status_enum" AS ENUM (
          'new',
          'called',
          'interested',
          'not_interested',
          'no_answer',
          'converted'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='leads' AND column_name='status'
        ) THEN
          ALTER TABLE "leads" ALTER COLUMN "status" DROP DEFAULT;
          ALTER TABLE "leads"
            ALTER COLUMN "status"
            TYPE "public"."leads_status_enum"
            USING (
              CASE "status"::text
                WHEN 'converted' THEN 'converted'
                WHEN 'discarded' THEN 'not_interested'
                WHEN 'new' THEN 'new'
                ELSE 'new'
              END
            )::"public"."leads_status_enum";
          ALTER TABLE "leads" ALTER COLUMN "status" SET DEFAULT 'new';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leads_status_enum_v2') THEN
          DROP TYPE "public"."leads_status_enum_v2";
        END IF;
      END $$;
    `);
  }
}

