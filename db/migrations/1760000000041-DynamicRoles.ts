import { MigrationInterface, QueryRunner } from 'typeorm';
import { SYSTEM_ROLE_PRESETS } from '../../src/common/permissions/role.presets';

/**
 * Dinamik rollar va ruxsatlar.
 *
 * Ilgari ruxsat `users.role` enum'iga qattiq bog'langan edi (`@Roles(ADMIN)`).
 * Endi har bir markaz (organization) o'z rollarini yaratadi va ularga
 * ruxsatlarni checkbox bilan beradi. `users.role` saqlanib qoladi — u endi
 * faqat "rol turi" (o'qituvchimi, adminmi) uchun ishlatiladi, ruxsatlar esa
 * `roles.permissions` dan o'qiladi.
 *
 * Backfill: har bir organizationga preset rollar yaratiladi va mavjud xodimlar
 * o'zining `role` ustuni bo'yicha mos rolga biriktiriladi. Ya'ni migratsiyadan
 * keyin hech kimning ruxsati o'zgarmaydi.
 */
export class DynamicRoles1760000000041 implements MigrationInterface {
  name = 'DynamicRoles1760000000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roles" (
        "id" SERIAL NOT NULL,
        "key" character varying NOT NULL,
        "name" character varying NOT NULL,
        "baseRole" "public"."users_role_enum" NOT NULL DEFAULT 'other',
        "permissions" text array NOT NULL DEFAULT '{}'::text[],
        "isSystem" boolean NOT NULL DEFAULT false,
        "isLocked" boolean NOT NULL DEFAULT false,
        "organizationId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roles_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_roles_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_roles_organization_key"
        ON "roles" ("organizationId", "key")
    `);

    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "userRoleId" integer
    `);

    // FK ni faqat bir marta qo'shamiz (IF NOT EXISTS ADD CONSTRAINT da yo'q)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_users_userRole'
        ) THEN
          ALTER TABLE "users"
            ADD CONSTRAINT "FK_users_userRole"
            FOREIGN KEY ("userRoleId") REFERENCES "roles"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // ── Backfill: har bir organizationga preset rollarni yaratamiz ──
    for (const preset of SYSTEM_ROLE_PRESETS) {
      await queryRunner.query(
        `
        INSERT INTO "roles" ("key", "name", "baseRole", "permissions", "isSystem", "isLocked", "organizationId")
        SELECT $1, $2, $3::"public"."users_role_enum", $4::text[], true, $5, o."id"
        FROM "organizations" o
        ON CONFLICT ("organizationId", "key") DO NOTHING
        `,
        [
          preset.key,
          preset.name.uz,
          preset.baseRole,
          preset.permissions,
          preset.locked,
        ],
      );
    }

    // ── Backfill: xodimlarni `role` ustuni bo'yicha mos rolga biriktiramiz ──
    await queryRunner.query(`
      UPDATE "users" u
      SET "userRoleId" = r."id"
      FROM "roles" r
      WHERE r."organizationId" = u."organizationId"
        AND r."baseRole" = u."role"
        AND r."isSystem" = true
        AND u."userRoleId" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_userRole"
    `);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "userRoleId"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_roles_organization_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
  }
}
