import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A'ZOLIK TARIXI (`student_group_enrollments`).
 *
 * Muammo: o'quvchi guruhdan chiqarilganda `students_groups_groups` qatori
 * o'chib ketardi. Bu bilan birga `joinedAt` ham yo'qolardi va:
 *  - o'tgan oylarning proratsiyasi buzilardi (guruh boshidan hisoblanardi);
 *  - "qachon chiqdi" degan sana hech qayerda saqlanmasdi, shuning uchun
 *    `recalcOpenPaymentRows` o'quvchi ketgan guruhning joriy oy to'lovini
 *    yana to'liq oyga qaytarib qo'yardi.
 *
 * Yechim: junction jadval "joriy a'zolik" uchun qoladi (guruh ro'yxati,
 * davomat jurnali, to'lov yaratish shu bo'yicha ishlaydi), bu jadval esa
 * **a'zolik oynalari** tarixini saqlaydi: `joinedAt` (inclusive — o'sha kungi
 * dars to'lovga kiradi) va `leftAt` (exclusive — o'sha kungi dars kirmaydi).
 * To'lov hisobi (billing) endi aynan shu jadvaldan o'qiydi.
 *
 * Bir (student, group) juftligi uchun bir nechta oyna bo'lishi mumkin
 * (chiqib, keyin qaytib kelgan holat). Ochiq oyna (leftAt IS NULL) esa
 * bittadan ortiq bo'lolmaydi — partial unique index.
 */
export class StudentGroupEnrollments1760000000046 implements MigrationInterface {
  name = 'StudentGroupEnrollments1760000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "student_group_enrollments" (
        "id" SERIAL PRIMARY KEY,
        "studentId" integer NOT NULL,
        "groupId" integer NOT NULL,
        "joinedAt" date NOT NULL,
        "leftAt" date,
        "leftReason" text,
        "transferredToGroupId" integer,
        "transferredFromGroupId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_sge_student" FOREIGN KEY ("studentId")
          REFERENCES "students"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sge_group" FOREIGN KEY ("groupId")
          REFERENCES "groups"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sge_to_group" FOREIGN KEY ("transferredToGroupId")
          REFERENCES "groups"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_sge_from_group" FOREIGN KEY ("transferredFromGroupId")
          REFERENCES "groups"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sge_student_group"
        ON "student_group_enrollments" ("studentId", "groupId", "joinedAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sge_group_left"
        ON "student_group_enrollments" ("groupId", "leftAt")
    `);
    // Ochiq a'zolik (hali chiqmagan) bitta juftlik uchun faqat bitta bo'lishi mumkin.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sge_open_enrollment"
        ON "student_group_enrollments" ("studentId", "groupId")
        WHERE "leftAt" IS NULL
    `);

    // Backfill: hozirgi biriktirishlar -> ochiq a'zolik oynalari.
    // joinedAt junction'dan olinadi (u yerda TIMESTAMP, bu yerda DATE).
    await queryRunner.query(`
      INSERT INTO "student_group_enrollments"
        ("studentId", "groupId", "joinedAt", "createdAt")
      SELECT sg."studentsId", sg."groupsId", sg."joinedAt"::date, now()
      FROM "students_groups_groups" sg
      WHERE NOT EXISTS (
        SELECT 1 FROM "student_group_enrollments" e
        WHERE e."studentId" = sg."studentsId"
          AND e."groupId" = sg."groupsId"
          AND e."leftAt" IS NULL
      )
    `);

    // ── To'lovlar: boshqa guruhga ko'chirilgan (qaytarilmagan) pul ──────────
    // `refundedAmount` — o'quvchiga naqd qaytarilgan pul. Ko'chirilgan pul esa
    // markazda qoladi, faqat boshqa guruh to'loviga o'tadi. Ikkalasi hisobotda
    // aralashib ketmasligi uchun alohida ustun.
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "transferredOutAmount" numeric(14,2) NOT NULL DEFAULT 0
    `);

    // Ko'chirilgan pul uchun chek: qaysi to'lovdan kelgani yozib qo'yiladi.
    // `paymentMethod` bunday chekda bo'sh qoladi (yangi pul olinmagan) —
    // chek "transfer" ekanini aynan shu ustun bildiradi.
    await queryRunner.query(`
      ALTER TABLE "payment_receipts"
      ADD COLUMN IF NOT EXISTS "transferFromPaymentId" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_receipts"
      DROP CONSTRAINT IF EXISTS "FK_receipt_transfer_from_payment"
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_receipts"
      ADD CONSTRAINT "FK_receipt_transfer_from_payment"
      FOREIGN KEY ("transferFromPaymentId")
      REFERENCES "payments"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_receipts"
      DROP CONSTRAINT IF EXISTS "FK_receipt_transfer_from_payment"
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_receipts" DROP COLUMN IF EXISTS "transferFromPaymentId"
    `);
    await queryRunner.query(`
      ALTER TABLE "payments" DROP COLUMN IF EXISTS "transferredOutAmount"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_sge_open_enrollment"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sge_group_left"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sge_student_group"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_group_enrollments"`);
  }
}
