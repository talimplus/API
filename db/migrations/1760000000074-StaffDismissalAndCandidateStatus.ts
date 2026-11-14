import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1) Xodimni ishdan bo'shatish (`users.dismissedAt/dismissalReason/dismissedById`).
 *    Bo'shatilgan xodim o'chirilmaydi: bloklanadi (`isActive = false`) va
 *    "Arxiv"da ko'rinadi. Mavjud xodimlar — ishlayapti (NULL), backfill yo'q.
 *
 * 2) Ishga nomzodlarga lavozim (`position`) va holat (`status`):
 *    - position: teacher / assistant / admin / manager / sales / marketing /
 *      accountant / other. Backfill: fani bor nomzod — `teacher`, qolgani — `other`.
 *    - status: new / hired / maybe / rejected. Backfill — `new`.
 *    - `hiredUserId` — "ishga kirdi" + xodimlarga o'tkazilganda yaratilgan xodim.
 */
export class StaffDismissalAndCandidateStatus1760000000074
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "dismissedAt" date NULL,
        ADD COLUMN IF NOT EXISTS "dismissalReason" text NULL,
        ADD COLUMN IF NOT EXISTS "dismissedById" integer NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "candidates"
        ADD COLUMN IF NOT EXISTS "position" varchar(30) NULL,
        ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'new',
        ADD COLUMN IF NOT EXISTS "hiredUserId" integer NULL
          REFERENCES "users"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "candidates"
         SET "position" = CASE WHEN "subjectId" IS NOT NULL THEN 'teacher' ELSE 'other' END
       WHERE "position" IS NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "candidates" ALTER COLUMN "position" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_candidates_status" ON "candidates" ("organizationId", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_candidates_status"`);
    await queryRunner.query(`
      ALTER TABLE "candidates"
        DROP COLUMN IF EXISTS "hiredUserId",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "position"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "dismissedById",
        DROP COLUMN IF EXISTS "dismissalReason",
        DROP COLUMN IF EXISTS "dismissedAt"
    `);
  }
}
