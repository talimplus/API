import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ustama o'tkazmasining (carryover) manbasi: qaysi o'quvchining, qaysi
 * guruhdagi, qaysi oy to'lovi tufayli ustoz ulushi boshqa oyga o'tgani.
 * Ish haqi sahifasida sabab oddiy so'z bilan ko'rsatiladi
 * ("Ali Valiyev (G-2) oktyabr to'lovini 16-noyabrda to'ladi").
 *
 * Backfill: o'tkazma yozilishidan oldingi 5 daqiqada tasdiqlangan, shu
 * o'qituvchi guruhining shu oy to'lovi cheki (eng yaqini). O'tkazma chek
 * tasdig'idan keyingi qayta hisobda yoziladi — vaqt shu bilan bog'lanadi.
 */
export class CarryoverSource1760000000077 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "teacher_commission_carryovers"
        ADD COLUMN IF NOT EXISTS "paymentId" integer
          REFERENCES "payments"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "receiptId" integer
          REFERENCES "payment_receipts"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "studentId" integer
          REFERENCES "students"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "groupId" integer
          REFERENCES "groups"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      UPDATE "teacher_commission_carryovers" c
         SET "paymentId" = m."paymentId",
             "receiptId" = m."receiptId",
             "studentId" = m."studentId",
             "groupId"   = m."groupId"
        FROM (
          SELECT DISTINCT ON (c2."id")
                 c2."id" AS "carryId", r."id" AS "receiptId",
                 p."id" AS "paymentId", p."studentId", p."groupId"
            FROM "teacher_commission_carryovers" c2
            JOIN "payments" p ON p."forMonth" = c2."sourceForMonth"
            JOIN "payment_receipts" r ON r."paymentId" = p."id"
            JOIN "groups" g ON g."id" = p."groupId"
           WHERE r."status" = 'confirmed'
             AND r."transferFromPaymentId" IS NULL
             AND r."confirmedAt" BETWEEN c2."createdAt" - INTERVAL '5 minutes'
                                     AND c2."createdAt"
             AND (g."teacherId" = c2."teacherId" OR EXISTS (
                   SELECT 1 FROM "group_teacher_periods" tp
                    WHERE tp."groupId" = g."id" AND tp."teacherId" = c2."teacherId"))
           ORDER BY c2."id", r."confirmedAt" DESC
        ) m
       WHERE c."id" = m."carryId" AND c."receiptId" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "teacher_commission_carryovers"
        DROP COLUMN IF EXISTS "groupId",
        DROP COLUMN IF EXISTS "studentId",
        DROP COLUMN IF EXISTS "receiptId",
        DROP COLUMN IF EXISTS "paymentId"
    `);
  }
}
