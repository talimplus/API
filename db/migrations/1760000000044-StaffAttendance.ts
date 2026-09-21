import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xodim davomati (hozircha faqat o'qituvchilar).
 *
 * 1. `centers` ga davomat sozlamalari: timezone, koordinata + radius, public IP.
 * 2. `staff_attendances` — kuniga bitta "Keldim" yozuvi, dalillari bilan.
 * 3. Tizim rollariga yangi ruxsatlar (o'qituvchi — o'ziniki, qabulxona/menejer —
 *    ko'rish va tasdiqlash).
 */
export class StaffAttendance1760000000044 implements MigrationInterface {
  name = 'StaffAttendance1760000000044';

  /** Tizim roliga yetishmayotgan ruxsatlarni qo'shadi (takrorlanmaydi) */
  private static addPerms(baseRole: string, keys: string[]): string {
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

  /** Tizim rolidan ruxsatlarni olib tashlaydi */
  private static removePerms(baseRole: string, keys: string[]): string {
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

  public async up(queryRunner: QueryRunner): Promise<void> {
    const M = StaffAttendance1760000000044;

    // ── 1. Markaz sozlamalari ──────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "centers"
        ADD COLUMN IF NOT EXISTS "timezone" character varying NOT NULL DEFAULT 'Asia/Tashkent',
        ADD COLUMN IF NOT EXISTS "latitude" numeric(10,7),
        ADD COLUMN IF NOT EXISTS "longitude" numeric(10,7),
        ADD COLUMN IF NOT EXISTS "checkInRadiusMeters" integer NOT NULL DEFAULT 150,
        ADD COLUMN IF NOT EXISTS "publicIp" character varying(64)
    `);

    // ── 2. Davomat jadvali ─────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "staff_attendances_source_enum" AS ENUM ('self', 'reception', 'manual');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "staff_attendances_confidence_enum" AS ENUM ('high', 'medium', 'low');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_attendances" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "centerId" integer,
        "organizationId" integer NOT NULL,
        "workDate" date NOT NULL,
        "checkInAt" TIMESTAMP NOT NULL,
        "firstLessonAt" TIME,
        "lateMinutes" integer NOT NULL DEFAULT 0,
        "source" "staff_attendances_source_enum" NOT NULL DEFAULT 'self',
        "confidence" "staff_attendances_confidence_enum" NOT NULL DEFAULT 'medium',
        "latitude" numeric(10,7),
        "longitude" numeric(10,7),
        "accuracyMeters" integer,
        "distanceMeters" integer,
        "geoMatched" boolean,
        "ip" character varying(64),
        "ipMatched" boolean,
        "deviceId" character varying(64),
        "userAgent" character varying(255),
        "flags" text,
        "confirmedByUserId" integer,
        "confirmedAt" TIMESTAMP,
        "note" character varying(500),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_attendances" PRIMARY KEY ("id")
      )
    `);

    // Kuniga bitta yozuv — takroriy "Keldim" bosilsa yangi qator yaratilmaydi
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_staff_attendances_user_day"
        ON "staff_attendances" ("userId", "workDate")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_staff_attendances_center_day"
        ON "staff_attendances" ("centerId", "workDate")
    `);
    // Bitta telefondan bir necha xodim kirishini topish uchun
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_staff_attendances_device"
        ON "staff_attendances" ("deviceId")
    `);

    await queryRunner.query(`
      ALTER TABLE "staff_attendances"
        DROP CONSTRAINT IF EXISTS "FK_staff_attendances_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_attendances"
        ADD CONSTRAINT "FK_staff_attendances_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_attendances"
        DROP CONSTRAINT IF EXISTS "FK_staff_attendances_center"
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_attendances"
        ADD CONSTRAINT "FK_staff_attendances_center"
        FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_attendances"
        DROP CONSTRAINT IF EXISTS "FK_staff_attendances_org"
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_attendances"
        ADD CONSTRAINT "FK_staff_attendances_org"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_attendances"
        DROP CONSTRAINT IF EXISTS "FK_staff_attendances_confirmed_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_attendances"
        ADD CONSTRAINT "FK_staff_attendances_confirmed_by"
        FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // ── 3. Ruxsatlar ───────────────────────────────────────────
    await queryRunner.query(
      M.addPerms('teacher', ['staffAttendance.checkIn', 'staffAttendance.viewOwn']),
    );
    await queryRunner.query(
      M.addPerms('manager', [
        'staffAttendance.checkIn',
        'staffAttendance.viewOwn',
        'staffAttendance.view',
        'staffAttendance.manage',
      ]),
    );
    await queryRunner.query(
      M.addPerms('reception', [
        'staffAttendance.checkIn',
        'staffAttendance.viewOwn',
        'staffAttendance.view',
        'staffAttendance.manage',
      ]),
    );
    await queryRunner.query(
      M.addPerms('other', ['staffAttendance.checkIn', 'staffAttendance.viewOwn']),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const M = StaffAttendance1760000000044;
    const keys = [
      'staffAttendance.checkIn',
      'staffAttendance.viewOwn',
      'staffAttendance.view',
      'staffAttendance.manage',
    ];
    for (const role of ['teacher', 'manager', 'reception', 'other']) {
      await queryRunner.query(M.removePerms(role, keys));
    }

    await queryRunner.query(`DROP TABLE IF EXISTS "staff_attendances"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "staff_attendances_source_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "staff_attendances_confidence_enum"`,
    );

    await queryRunner.query(`
      ALTER TABLE "centers"
        DROP COLUMN IF EXISTS "timezone",
        DROP COLUMN IF EXISTS "latitude",
        DROP COLUMN IF EXISTS "longitude",
        DROP COLUMN IF EXISTS "checkInRadiusMeters",
        DROP COLUMN IF EXISTS "publicIp"
    `);
  }
}
