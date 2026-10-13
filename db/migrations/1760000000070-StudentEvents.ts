import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O'quvchi tarixi (timeline) uchun voqealar jurnali — `student_events`.
 *
 * Tarixning katta qismi boshqa jadvallardan o'qib yig'iladi (a'zolik oynalari,
 * cheklar, chegirmalar, davomat). Bu jadvalga faqat **boshqa joyda izi
 * qolmaydigan** amallar yoziladi: holat o'zgarishi (sababi bilan), ma'lumot
 * tahriri, ko'chirishni kim qilgani va summalari, qo'lda chiqarilgan summa.
 *
 * `actorId` — amalni bajargan xodim; xodim o'chirilsa (aslida bloklanadi)
 * yozuv qoladi, faqat muallif bo'shaydi.
 */
export class StudentEvents1760000000070 implements MigrationInterface {
  name = 'StudentEvents1760000000070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "student_events" (
        "id" SERIAL PRIMARY KEY,
        "studentId" integer NOT NULL,
        "organizationId" integer NOT NULL,
        "type" varchar(40) NOT NULL,
        "actorId" integer NULL,
        "groupId" integer NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurredAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_student_events_student" FOREIGN KEY ("studentId")
          REFERENCES "students"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_student_events_actor" FOREIGN KEY ("actorId")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_student_events_group" FOREIGN KEY ("groupId")
          REFERENCES "groups"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_student_events_student_time" ON "student_events" ("studentId", "occurredAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "student_events"`);
  }
}
