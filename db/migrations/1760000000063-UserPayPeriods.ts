import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xodim oyligi va komissiya foizi tarixi (oy aniqligida).
 *
 * Ilgari foiz o'zgartirilsa, oyligi hali berilmagan barcha oylar (o'tgan
 * oylar uchun kech tushgan o'quvchi puli ham) yangi foizda qayta
 * hisoblanardi. Endi o'zgartirilgan oydan boshlab yangi qiymat amal qiladi.
 *
 * Backfill yozilmaydi: jadval bo'sh bo'lsa `users` ustunlari ishlatiladi,
 * birinchi o'zgarishda eski qiymat oldingi oy uchun tarixga yoziladi.
 */
export class UserPayPeriods1760000000063 implements MigrationInterface {
  name = 'UserPayPeriods1760000000063';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_pay_periods" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "fromMonth" date NOT NULL,
        "salary" numeric NOT NULL DEFAULT 0,
        "commissionPercentage" numeric NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_pay_periods" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_pay_periods_user_month"
        ON "user_pay_periods" ("userId", "fromMonth")
    `);
    await queryRunner.query(`
      ALTER TABLE "user_pay_periods" DROP CONSTRAINT IF EXISTS "FK_user_pay_periods_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_pay_periods"
      ADD CONSTRAINT "FK_user_pay_periods_user"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_pay_periods"`);
  }
}
