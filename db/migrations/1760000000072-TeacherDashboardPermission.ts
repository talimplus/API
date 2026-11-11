import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Yangi ruxsat `teacher.dashboard` (o'qituvchi dashboardi). "Bugungi darslarim"
 * (`teacher.today`) bor har bir rolga qo'shiladi — tizim `teacher` roli ham,
 * markaz o'zi yaratgan o'qituvchi rollari ham. Admin (`*`) tegilmaydi.
 * Idempotent: allaqachon bor bo'lsa ikkinchi marta yozilmaydi.
 */
export class TeacherDashboardPermission1760000000072
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "roles"
         SET "permissions" = array_append("permissions", 'teacher.dashboard')
       WHERE 'teacher.today' = ANY("permissions")
         AND NOT ('teacher.dashboard' = ANY("permissions"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "roles"
         SET "permissions" = array_remove("permissions", 'teacher.dashboard')
    `);
  }
}
