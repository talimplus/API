import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed qilingan tizim rollarining ruxsatlarini migratsiyadan OLDINGI holatga
 * aniq moslashtiradi.
 *
 * `DynamicRoles` migratsiyasidagi preset'larda bir necha nomuvofiqlik bor edi —
 * eski `@Roles(...)` bilan solishtirganda ba'zi rollarga ortiqcha ruxsat berilib,
 * ba'zilari esa ilgari qila olgan ishini qila olmay qolgan edi:
 *
 *  - Menejer cheklarni **tasdiqlay** oladigan bo'lib qolgan edi (ilgari faqat admin).
 *  - Qabulxona **guruh o'chira** oladigan bo'lib qolgan edi (ilgari faqat admin).
 *  - Qabulxona guruh **statusini** o'zgartira olmay qolgandi (ilgari qila olardi).
 *  - Qabulxona to'lov eksporti / qayta hisoblash / chiqarib tashlashni yo'qotgandi.
 *  - O'qituvchi guruhga kurs rejasini **biriktira** oladigan bo'lib qolgan edi —
 *    buning uchun endi alohida `groupPlan.attach` ruxsati bor.
 *
 * Faqat shu kalitlarga tegamiz: admin qo'lda qo'shgan boshqa ruxsatlar saqlanadi.
 * `admin` roli (`['*']`) va admin o'zi yaratgan rollar umuman o'zgarmaydi.
 */
export class FixSeededRolePermissions1760000000042
  implements MigrationInterface
{
  name = 'FixSeededRolePermissions1760000000042';

  /**
   * Tizim rolidan ruxsat olib tashlaydi.
   * Postgres bitta UPDATE da ustunga ikki marta yozdirmaydi — shuning uchun
   * `array_remove` chaqiruvlari ichma-ich qo'yiladi.
   */
  private static remove(baseRole: string, keys: string[]): string {
    const expr = keys.reduce(
      (acc, key) => `array_remove(${acc}, '${key}')`,
      '"permissions"',
    );
    return `
      UPDATE "roles"
      SET "permissions" = ${expr}
      WHERE "isSystem" = true AND "baseRole" = '${baseRole}'
    `;
  }

  /** Tizim roliga yetishmayotgan ruxsatlarni qo'shadi (takrorlanmaydi) */
  private static add(baseRole: string, keys: string[]): string {
    const wanted = keys.map((key) => `'${key}'`).join(', ');
    return `
      UPDATE "roles"
      SET "permissions" = "permissions" || ARRAY(
        SELECT unnest(ARRAY[${wanted}]::text[])
        EXCEPT
        SELECT unnest("permissions")
      )
      WHERE "isSystem" = true AND "baseRole" = '${baseRole}'
    `;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const M = FixSeededRolePermissions1760000000042;

    // ── Menejer ──────────────────────────────────────────────────
    await queryRunner.query(
      M.remove('manager', ['receipts.view', 'receipts.confirm']),
    );
    await queryRunner.query(
      M.add('manager', [
        'groupPlan.attach',
        'payments.recalculate',
        'payments.exclusion',
      ]),
    );

    // ── Qabulxona ────────────────────────────────────────────────
    await queryRunner.query(
      M.remove('reception', ['groups.delete', 'receipts.view']),
    );
    await queryRunner.query(
      M.add('reception', [
        'groups.changeStatus',
        'payments.export',
        'payments.recalculate',
        'payments.exclusion',
      ]),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const M = FixSeededRolePermissions1760000000042;

    await queryRunner.query(
      M.add('manager', ['receipts.view', 'receipts.confirm']),
    );
    await queryRunner.query(
      M.remove('manager', [
        'groupPlan.attach',
        'payments.recalculate',
        'payments.exclusion',
      ]),
    );

    await queryRunner.query(
      M.add('reception', ['groups.delete', 'receipts.view']),
    );
    await queryRunner.query(
      M.remove('reception', [
        'groups.changeStatus',
        'payments.export',
        'payments.recalculate',
        'payments.exclusion',
      ]),
    );
  }
}
