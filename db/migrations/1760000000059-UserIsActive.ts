import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xodimni bloklash (`users.isActive`).
 *
 * Ilgari ishdan ketgan xodimning kirishini to'xtatishning yagona yo'li uni
 * o'chirish edi — bu esa CASCADE bilan uning oyliklari, komissiya tarixi va
 * jarimalarini ham o'chirib yuborardi. Endi xodim bloklanadi: tizimga kira
 * olmaydi, tarix esa saqlanadi.
 */
export class UserIsActive1760000000059 implements MigrationInterface {
  name = 'UserIsActive1760000000059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "isActive"`,
    );
  }
}
