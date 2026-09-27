import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `student` tizim roli.
 *
 * `DynamicRoles` preset'larida o'quvchi roli yo'q edi, shuning uchun
 * `POST /students` (o'quvchiga kabinet akkaunti ochadi) `Rol tanlanmagan`
 * bilan yiqilardi, oldin yaratilgan student akkauntlari esa rolsiz qolgan.
 *
 * Backfill: har bir organizationga ruxsatsiz, qulflangan `student` roli va
 * rolsiz student akkauntlari shu rolga biriktiriladi.
 */
export class StudentSystemRole1760000000055 implements MigrationInterface {
  name = 'StudentSystemRole1760000000055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "roles" ("key", "name", "baseRole", "permissions", "isSystem", "isLocked", "organizationId")
      SELECT 'student', 'O‘quvchi', 'student'::"public"."users_role_enum", '{}'::text[], true, true, o."id"
        FROM "organizations" o
      ON CONFLICT ("organizationId", "key") DO NOTHING
    `);

    await queryRunner.query(`
      UPDATE "users" u
         SET "userRoleId" = r."id"
        FROM "roles" r
       WHERE r."organizationId" = u."organizationId"
         AND r."baseRole" = 'student'
         AND r."isSystem" = true
         AND u."role" = 'student'
         AND u."userRoleId" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "users" SET "userRoleId" = NULL
       WHERE "userRoleId" IN (
         SELECT "id" FROM "roles" WHERE "key" = 'student' AND "isSystem" = true
       )
    `);
    await queryRunner.query(
      `DELETE FROM "roles" WHERE "key" = 'student' AND "isSystem" = true`,
    );
  }
}
