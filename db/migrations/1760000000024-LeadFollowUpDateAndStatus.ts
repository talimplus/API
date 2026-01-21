import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class LeadFollowUpDateAndStatus1760000000024 implements MigrationInterface {
  name = 'LeadFollowUpDateAndStatus1760000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add followUpDate column
    await queryRunner.addColumn(
      'leads',
      new TableColumn({
        name: 'followUpDate',
        type: 'date',
        isNullable: true,
      }),
    );

    // Update enum to include 'keyinroq' status
    // PostgreSQL enum alteration - need to handle default value separately
    await queryRunner.query(`
      DO $$
      BEGIN
        -- Rename old enum type
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
        -- Create new enum type with 'keyinroq'
        CREATE TYPE "public"."leads_status_enum" AS ENUM ('new','converted','discarded','keyinroq');
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
          -- Drop default constraint first
          ALTER TABLE "leads" ALTER COLUMN "status" DROP DEFAULT;
          
          -- Alter column type
          ALTER TABLE "leads"
            ALTER COLUMN "status"
            TYPE "public"."leads_status_enum"
            USING (
              CASE "status"::text
                WHEN 'new' THEN 'new'
                WHEN 'converted' THEN 'converted'
                WHEN 'discarded' THEN 'discarded'
                WHEN 'keyinroq' THEN 'keyinroq'
                ELSE 'new'
              END
            )::"public"."leads_status_enum";
          
          -- Restore default value
          ALTER TABLE "leads" ALTER COLUMN "status" SET DEFAULT 'new';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        -- Drop old enum type
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leads_status_enum_old') THEN
          DROP TYPE "public"."leads_status_enum_old";
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove followUpDate column
    await queryRunner.dropColumn('leads', 'followUpDate');

    // Revert enum to original (remove 'keyinroq')
    // First update any 'keyinroq' values to 'new'
    await queryRunner.query(`
      UPDATE "leads" SET "status" = 'new' WHERE "status" = 'keyinroq';
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        -- Rename current enum type
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
        -- Create old enum type without 'keyinroq'
        CREATE TYPE "public"."leads_status_enum" AS ENUM ('new','converted','discarded');
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
          -- Drop default constraint first
          ALTER TABLE "leads" ALTER COLUMN "status" DROP DEFAULT;
          
          -- Alter column type
          ALTER TABLE "leads"
            ALTER COLUMN "status"
            TYPE "public"."leads_status_enum"
            USING (
              CASE "status"::text
                WHEN 'new' THEN 'new'
                WHEN 'converted' THEN 'converted'
                WHEN 'discarded' THEN 'discarded'
                ELSE 'new'
              END
            )::"public"."leads_status_enum";
          
          -- Restore default value
          ALTER TABLE "leads" ALTER COLUMN "status" SET DEFAULT 'new';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        -- Drop old enum type
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leads_status_enum_old') THEN
          DROP TYPE "public"."leads_status_enum_old";
        END IF;
      END $$;
    `);
  }
}
