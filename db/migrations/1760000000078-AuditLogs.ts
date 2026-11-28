import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Harakatlar jurnali (audit log): tizimda ma'lumotni o'zgartiradigan har bir
 * so'rov (POST/PUT/PATCH/DELETE) — kim, qachon, qaysi endpoint, qaysi obyekt,
 * yuborilgan ma'lumot (sirlar niqoblangan), natija va IP.
 *
 * Yozuvni global `AuditLogInterceptor` qiladi. Eski harakatlar uchun backfill
 * yo'q — jurnal shu migratsiyadan keyin to'la boshlaydi.
 */
export class AuditLogs1760000000078 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" BIGSERIAL PRIMARY KEY,
        "organizationId" integer NOT NULL
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        "centerId" integer REFERENCES "centers"("id") ON DELETE SET NULL,
        "actorId" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "module" varchar(40) NOT NULL,
        "action" varchar(20) NOT NULL,
        "method" varchar(10) NOT NULL,
        "path" varchar(255) NOT NULL,
        "url" text NOT NULL,
        "handler" varchar(160),
        "summary" text,
        "entityId" varchar(64),
        "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "query" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "body" jsonb,
        "statusCode" integer NOT NULL,
        "success" boolean NOT NULL,
        "errorMessage" text,
        "ip" varchar(64),
        "userAgent" text,
        "durationMs" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_org_created"
        ON "audit_logs" ("organizationId", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_org_actor_created"
        ON "audit_logs" ("organizationId", "actorId", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_org_module_created"
        ON "audit_logs" ("organizationId", "module", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}
