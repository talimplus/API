import { MigrationInterface, QueryRunner } from 'typeorm';

export class Leads1760000000016 implements MigrationInterface {
  name = 'Leads1760000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
      CREATE TABLE IF NOT EXISTS "leads" (
        "id" SERIAL NOT NULL,
        "firstName" character varying,
        "lastName" character varying,
        "phone" character varying NOT NULL,
        "secondPhone" character varying,
        "birthDate" date,
        "monthlyFee" numeric,
        "discountPercent" numeric NOT NULL DEFAULT 0,
        "discountReason" text,
        "comment" text,
        "heardAboutUs" text,
        "preferredTime" text,
        "preferredDays" text array,
        "passportSeries" character varying,
        "passportNumber" character varying,
        "jshshir" character varying,
        "status" "public"."leads_status_enum" NOT NULL DEFAULT 'new',
        "studentId" integer,
        "centerId" integer NOT NULL,
        "organizationId" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leads_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_leads_center" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_leads_org" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_leads_org_phone" ON "leads" ("organizationId", "phone")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leads_groups_groups" (
        "leadId" integer NOT NULL,
        "groupId" integer NOT NULL,
        CONSTRAINT "PK_leads_groups" PRIMARY KEY ("leadId", "groupId"),
        CONSTRAINT "FK_leads_groups_lead" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_leads_groups_group" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_leads_groups_lead" ON "leads_groups_groups" ("leadId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_leads_groups_group" ON "leads_groups_groups" ("groupId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "leads_groups_groups"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_leads_org_phone"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "leads"`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leads_status_enum') THEN
          DROP TYPE "public"."leads_status_enum";
        END IF;
      END $$;
    `);
  }
}

