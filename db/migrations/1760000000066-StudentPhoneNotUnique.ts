import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `users.phone` endi faqat xodimlar orasida unique.
 *
 * Bir oiladan bir nechta o'quvchi kelishi mumkin va ular bitta (ota-ona)
 * raqami bilan yoziladi. O'quvchi kabinet akkaunti (`role = 'student'`)
 * login orqali kiradi, telefon orqali emas — shuning uchun ularda telefon
 * takrorlanishi xavfsiz. Xodimlar uchun cheklov saqlanadi.
 */
export class StudentPhoneNotUnique1760000000066 implements MigrationInterface {
  name = 'StudentPhoneNotUnique1760000000066';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Eski global unique — nomi bazadan bazaga farq qilishi mumkin, shuning
    // uchun `users(phone)` ustidagi har qanday bitta ustunli unique o'chiriladi.
    await queryRunner.query(`
      DO $$
      DECLARE c record;
      BEGIN
        FOR c IN
          SELECT con.conname
            FROM pg_constraint con
            JOIN pg_attribute att
              ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
           WHERE con.conrelid = '"users"'::regclass
             AND con.contype = 'u'
             AND array_length(con.conkey, 1) = 1
             AND att.attname = 'phone'
        LOOP
          EXECUTE format('ALTER TABLE "users" DROP CONSTRAINT %I', c.conname);
        END LOOP;
      END $$;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_phone_staff"
        ON "users" ("phone") WHERE "role" <> 'student'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ⚠️ Bir xil raqamli o'quvchilar paydo bo'lgan bo'lsa, qaytarish yiqiladi.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_phone_staff"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE ("phone")
    `);
  }
}
