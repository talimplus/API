import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1) Shaxsiy narx endi HAR BIR GURUHGA alohida (`student_group_fees`).
 *    Ilgari bitta `students.monthlyFee` (+ `student_base_discounts.monthlyFee`
 *    tarixi) o'quvchining barcha guruhlariga qo'llanardi: 200 ming va 500 ming
 *    lik ikki guruhda o'qiganga 150 ming yozilsa — ikkalasiga 150 mingdan.
 *
 *    Backfill hisobni O'ZGARTIRMAYDI: shaxsiy narxi bo'lgan har bir o'quvchining
 *    narx tarixi (`student_base_discounts`, NULL — `students.monthlyFee`) u
 *    o'qigan/o'qiyotgan HAR BIR guruhga nusxalanadi (junction + a'zolik
 *    oynalari + to'lov qatorlari). Tanlash qoidasi o'sha-o'sha: oy uchun
 *    `fromMonth <= oy` ga mos eng oxirgi qator, bo'lmasa eng birinchisi.
 *    Keyin admin kerakli guruhda narxni o'zgartiradi yoki olib tashlaydi.
 *
 * 2) `payments.creditAmount` — "keyingi oylarga o'tadigan" ortiqcha pul
 *    (o'quvchining balansi, markazda turadi). Kunlik cron va o'tkazish paytida
 *    o'quvchining keyingi ochiq oylariga ko'chirish cheki bilan yoziladi
 *    (`transferredOutAmount` ga o'tadi). `refundedAmount` dan farqi — pul
 *    kassadan chiqmaydi.
 */
export class StudentGroupFees1760000000075 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "student_group_fees" (
        "id" SERIAL PRIMARY KEY,
        "studentId" integer NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "groupId" integer NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
        "fromMonth" date NOT NULL,
        "monthlyFee" numeric NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_student_group_fees_month"
        ON "student_group_fees" ("studentId", "groupId", "fromMonth")
    `);

    await queryRunner.query(`
      WITH fee_students AS (
        SELECT s."id", COALESCE(s."monthlyFee", 0)::numeric AS "fee", s."createdAt"
          FROM "students" s
         WHERE COALESCE(s."monthlyFee", 0) > 0
            OR EXISTS (SELECT 1 FROM "student_base_discounts" b
                        WHERE b."studentId" = s."id" AND b."monthlyFee" > 0)
      ),
      pairs AS (
        SELECT j."studentsId" AS "studentId", j."groupsId" AS "groupId"
          FROM "students_groups_groups" j
         WHERE j."studentsId" IN (SELECT "id" FROM fee_students)
        UNION
        SELECT e."studentId", e."groupId" FROM "student_group_enrollments" e
         WHERE e."studentId" IN (SELECT "id" FROM fee_students)
        UNION
        SELECT p."studentId", p."groupId" FROM "payments" p
         WHERE p."groupId" IS NOT NULL
           AND p."studentId" IN (SELECT "id" FROM fee_students)
      ),
      timeline AS (
        SELECT fs."id" AS "studentId", b."fromMonth",
               COALESCE(b."monthlyFee", fs."fee") AS "monthlyFee"
          FROM fee_students fs
          JOIN "student_base_discounts" b ON b."studentId" = fs."id"
        UNION ALL
        SELECT fs."id", date_trunc('month', fs."createdAt")::date, fs."fee"
          FROM fee_students fs
         WHERE NOT EXISTS (SELECT 1 FROM "student_base_discounts" b
                            WHERE b."studentId" = fs."id")
      )
      INSERT INTO "student_group_fees" ("studentId", "groupId", "fromMonth", "monthlyFee")
      SELECT t."studentId", p."groupId", t."fromMonth", t."monthlyFee"
        FROM timeline t
        JOIN pairs p ON p."studentId" = t."studentId"
        JOIN "groups" g ON g."id" = p."groupId"
      ON CONFLICT ("studentId", "groupId", "fromMonth") DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE "payments"
        ADD COLUMN IF NOT EXISTS "creditAmount" numeric(14,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN IF EXISTS "creditAmount"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "student_group_fees"`);
  }
}
